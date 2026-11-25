# Play Amelia: tiny static file server for Windows (PowerShell 5.1 or newer, also pwsh 7).
# Serves the "game" folder next to this script on 127.0.0.1 only. Same rules as server.js, including the second copy
# of every save (package 81, D87): /api/home/save/1..3 keeps data\home\slotN.json and data\home\history\, and a request
# for localhost is sent on to 127.0.0.1 (the browser keeps the two addresses' saves apart). WS_DATA moves the data folder.
# Parameters for tests: -Port 4190 -NoBrowser
param(
  [int]$Port = 4173,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root = [System.IO.Path]::GetFullPath((Join-Path $here 'game'))
$sep = [string][System.IO.Path]::DirectorySeparatorChar
if (-not $root.EndsWith($sep)) { $rootDir = $root + $sep } else { $rootDir = $root }

# The data folder (the home copy's saves live in data\home): beside this script, or WS_DATA. Never inside game\.
if ($env:WS_DATA) { $dataDir = [System.IO.Path]::GetFullPath($env:WS_DATA) } else { $dataDir = [System.IO.Path]::GetFullPath((Join-Path $here 'data')) }
$dataCheck = $dataDir.TrimEnd([char[]]@('\', '/')) + $sep
if ($dataCheck.StartsWith($rootDir, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Host 'WS_DATA must not be inside the game folder'
  exit 1
}
# One lock for every save operation: handlers run side by side, and a save is written by temp file and move.
$lock = New-Object System.Object

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start(64)
} catch {
  Write-Host 'Close the other Play Amelia window and try again'
  if (-not $NoBrowser) {
    Write-Host 'Press any key to close this window.'
    try { [void][System.Console]::ReadKey($true) } catch { Start-Sleep -Seconds 10 }
  }
  exit 1
}

# One handler per connection, run on a pool of runspaces so a slow connection cannot block the rest.
$handler = {
  param($client, $root, $rootDir, $port, $dataDir, $lock)
  $types = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'; '.webp' = 'image/webp'; '.png' = 'image/png'
    '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.svg' = 'image/svg+xml'
    '.woff2' = 'font/woff2'; '.wasm' = 'application/wasm'; '.mp3' = 'audio/mpeg'
    '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.txt' = 'text/plain; charset=utf-8'
    '.ico' = 'image/x-icon'
  }
  $reasons = @{ 200 = 'OK'; 302 = 'Found'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'
    408 = 'Request Timeout'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }
  $json = 'application/json; charset=utf-8'
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $invariant = [System.Globalization.CultureInfo]::InvariantCulture
  $stampFormat = "yyyyMMdd'T'HHmmss'Z'"
  $maxHome = 1048576
  $historyGap = [TimeSpan]::FromMinutes(10)
  $historyKeep = 40

  # ---- the home copy's second copy (same rules as server.js) ----
  function Get-Stamp([DateTime]$t) { $t.ToString($stampFormat, $invariant) }
  # A file is written whole to a temporary file next to it, then moved over the old one.
  function Write-Atomic([string]$file, [byte[]]$bytes) {
    $tmp = $file + '.' + [System.Guid]::NewGuid().ToString('N') + '.tmp'
    [System.IO.File]::WriteAllBytes($tmp, $bytes)
    for ($try = 1; $true; $try++) {
      try {
        if ([System.IO.File]::Exists($file)) { [void][System.IO.File]::Replace($tmp, $file, [NullString]::Value) } else { [System.IO.File]::Move($tmp, $file) }
        return
      } catch {
        if ($try -ge 5) {
          try { [System.IO.File]::Delete($tmp) } catch {}
          throw
        }
        Start-Sleep -Milliseconds 100
      }
    }
  }
  # The history files of a slot, oldest first (moved-aside "-deleted" ones are not listed).
  function Get-History([string]$histDir, [int]$n) {
    $names = New-Object 'System.Collections.Generic.List[string]'
    if ([System.IO.Directory]::Exists($histDir)) {
      foreach ($f in [System.IO.Directory]::GetFiles($histDir, "slot${n}-*.json")) {
        $name = [System.IO.Path]::GetFileName($f)
        if ($name -cmatch "^slot${n}-\d{8}T\d{6}Z\.json$") { [void]$names.Add($name) }
      }
    }
    $names.Sort([System.StringComparer]::Ordinal)
    return ,$names
  }
  # What a saved game must be: a JSON object with a number v. (A text starting with "{" is an object, whatever
  # ConvertFrom-Json does with arrays on this PowerShell.)
  function Test-Save([string]$text) {
    if ($text.TrimStart([char[]]@(' ', "`t", "`r", "`n")).StartsWith('{') -eq $false) { return $false }
    try { $o = ConvertFrom-Json -InputObject $text -ErrorAction Stop } catch { return $false }
    if ($null -eq $o -or $o -isnot [System.Management.Automation.PSCustomObject]) { return $false }
    if (-not ($o.PSObject.Properties.Name -ccontains 'v')) { return $false }
    $v = $o.v
    return ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] -or $v -is [System.Numerics.BigInteger])
  }
  try {
    $client.ReceiveTimeout = 15000
    $client.SendTimeout = 30000
    $stream = $client.GetStream()
    # Read the request head (up to the blank line, at most 16 KB).
    $buf = New-Object byte[] 16384
    $len = 0
    $head = ''
    while ($len -lt $buf.Length) {
      $n = $stream.Read($buf, $len, $buf.Length - $len)
      if ($n -le 0) { break }
      $len += $n
      $head = [System.Text.Encoding]::ASCII.GetString($buf, 0, $len)
      if ($head.Contains("`r`n`r`n")) { break }
    }
    $headEnd = $head.IndexOf("`r`n`r`n")
    $lineEnd = $head.IndexOf("`r`n")
    if ($lineEnd -lt 0) { $lineEnd = $head.Length }
    $parts = $head.Substring(0, $lineEnd).Split(' ')
    # The header lines, names in lower case.
    $headers = @{}
    if ($headEnd -ge 0) {
      foreach ($line in $head.Substring(0, $headEnd).Split([string[]]@("`r`n"), [System.StringSplitOptions]::None) | Select-Object -Skip 1) {
        $colon = $line.IndexOf(':')
        if ($colon -gt 0) { $headers[$line.Substring(0, $colon).Trim().ToLowerInvariant()] = $line.Substring($colon + 1).Trim() }
      }
    }
    $code = 200
    $ctype = 'text/plain; charset=utf-8'
    $body = [byte[]]@()
    $extra = ''
    $custom = $false
    $drain = 0
    $method = ''
    $file = $null
    if ($parts.Length -lt 2) {
      $code = 400
    } else {
      $method = $parts[0]
      $target = $parts[1]
      $pathOnly = $target
      $q = $pathOnly.IndexOfAny([char[]]'?#')
      if ($q -ge 0) { $pathOnly = $pathOnly.Substring(0, $q) }
      try {
        $rel = [System.Uri]::UnescapeDataString($pathOnly)
      } catch {
        $rel = $null
      }
      $hostName = $headers['host']
      if ($null -ne $hostName -and $hostName -match '^localhost(:(\d+))?$') {
        # One address, so one browser storage: localhost is sent on to 127.0.0.1 (same port, same path and query).
        $toPort = $Matches[2]
        if (-not $toPort) { $toPort = [string]$port }
        $code = 302
        $custom = $true
        $ctype = $null
        $extra = "Location: http://127.0.0.1:${toPort}${target}`r`n"
      } elseif ([string]::Equals($rel, '/api/players', [System.StringComparison]::Ordinal)) {
        # The game asks once at boot whether this is players mode; the home copy answers with an empty list (as server.js
        # does), so there is no 404 in the browser console.
        $custom = $true
        $ctype = $json
        $body = $utf8.GetBytes('{"players":[]}')
      } elseif ($null -ne $rel -and $rel.StartsWith('/api/home/', [System.StringComparison]::Ordinal)) {
        $custom = $true
        $ctype = $json
        $homeDir = [System.IO.Path]::Combine($dataDir, 'home')
        $histDir = [System.IO.Path]::Combine($homeDir, 'history')
        if ($rel -cmatch '^/api/home/save/([123])$') {
          $slot = [int]$Matches[1]
          $slotFile = [System.IO.Path]::Combine($homeDir, "slot${slot}.json")
          $text = $null
          if ($method -eq 'PUT') {
            # Read the body: at most 1 MB, exactly Content-Length bytes.
            $cl = [long]0
            if ($headers.ContainsKey('transfer-encoding')) {
              $code = 400; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Bad request')
            } elseif ($headers.ContainsKey('content-length') -and -not [long]::TryParse($headers['content-length'], [System.Globalization.NumberStyles]::None, $invariant, [ref]$cl)) {
              $code = 400; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Bad request')
            } elseif ($cl -gt $maxHome) {
              $code = 413; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Too large')
              if ($headEnd -ge 0) { $drain = [Math]::Min($cl - ($len - ($headEnd + 4)), 16777216) }
            } elseif ($headEnd -lt 0) {
              $code = 400; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Bad request')
            } else {
              $bytes = New-Object byte[] ([int]$cl)
              $have = [Math]::Min([int]$cl, $len - ($headEnd + 4))
              if ($have -gt 0) { [System.Array]::Copy($buf, $headEnd + 4, $bytes, 0, $have) }
              try {
                while ($have -lt $bytes.Length) {
                  $n = $stream.Read($bytes, $have, $bytes.Length - $have)
                  if ($n -le 0) { break }
                  $have += $n
                }
              } catch {
                $have = -1
              }
              if ($have -lt 0) {
                $code = 408; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Too slow')
              } elseif ($have -lt $bytes.Length) {
                $code = 400; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Bad request')
              } else {
                $text = $utf8.GetString($bytes)
              }
            }
          }
          $done = $false
          if ($method -eq 'PUT' -and $null -eq $text) { $done = $true }
          if (-not $done) {
            [System.Threading.Monitor]::Enter($lock)
            try {
              if ($method -eq 'GET') {
                if ([System.IO.File]::Exists($slotFile)) {
                  $body = [System.IO.File]::ReadAllBytes($slotFile)
                } else {
                  $code = 404; $body = $utf8.GetBytes('{"error":"none"}')
                }
              } elseif ($method -eq 'PUT') {
                if (-not (Test-Save $text)) {
                  $code = 400; $body = $utf8.GetBytes('{"error":"not a save"}')
                } else {
                  # The folder is made on the first write only.
                  [void][System.IO.Directory]::CreateDirectory($histDir)
                  Write-Atomic $slotFile $bytes
                  $list = Get-History $histDir $slot
                  $now = [DateTime]::UtcNow
                  $recent = $false
                  if ($list.Count -gt 0) {
                    $last = [DateTime]::ParseExact(($list[$list.Count - 1] -replace '^slot\d-|\.json$', ''), $stampFormat, $invariant, [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                    if (($now - $last) -lt $historyGap) { $recent = $true }
                  }
                  if (-not $recent) {
                    Write-Atomic ([System.IO.Path]::Combine($histDir, "slot${slot}-$(Get-Stamp $now).json")) $bytes
                    $list = Get-History $histDir $slot
                    for ($i = 0; $i -lt $list.Count - $historyKeep; $i++) {
                      [System.IO.File]::Delete([System.IO.Path]::Combine($histDir, $list[$i]))
                    }
                  }
                  $body = $utf8.GetBytes('{"ok":true}')
                }
              } elseif ($method -eq 'DELETE') {
                # The copy moves into history and is never thinned: nothing is destroyed.
                if ([System.IO.File]::Exists($slotFile)) {
                  $now = [DateTime]::UtcNow
                  $dest = [System.IO.Path]::Combine($histDir, "slot${slot}-$(Get-Stamp $now)-deleted.json")
                  for ($i = 2; [System.IO.File]::Exists($dest); $i++) {
                    $dest = [System.IO.Path]::Combine($histDir, "slot${slot}-$(Get-Stamp $now)-deleted-${i}.json")
                  }
                  [System.IO.File]::Move($slotFile, $dest)
                  $body = $utf8.GetBytes('{"ok":true}')
                } else {
                  $code = 404; $body = $utf8.GetBytes('{"error":"none"}')
                }
              } else {
                $code = 405; $body = $utf8.GetBytes('{"error":"method"}')
              }
            } catch {
              $code = 500; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Server error')
            } finally {
              [System.Threading.Monitor]::Exit($lock)
            }
          }
        } else {
          $code = 404; $ctype = 'text/plain; charset=utf-8'; $body = $utf8.GetBytes('Not found')
        }
      } elseif ($method -ne 'GET' -and $method -ne 'HEAD') {
        $code = 405
      } else {
        if ($null -eq $rel -or -not $rel.StartsWith('/')) {
          $code = 400
        } elseif ($rel.Contains([string][char]0) -or (($rel -split '[\\/]') -contains '..') -or $rel.Contains(':')) {
          $code = 403
        } else {
          $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $rel.TrimStart('/').Replace('/', [string][System.IO.Path]::DirectorySeparatorChar)))
          if ([System.IO.Directory]::Exists($path)) { $path = [System.IO.Path]::Combine($path, 'index.html') }
          if (-not ($path -eq $root -or $path.StartsWith($rootDir, [System.StringComparison]::OrdinalIgnoreCase))) {
            $code = 403
          } elseif (-not [System.IO.File]::Exists($path)) {
            $code = 404
          } else {
            $file = $path
          }
        }
      }
    }
    $size = 0
    if ($custom) {
      $size = $body.Length
    } elseif ($code -eq 200 -and $null -ne $file) {
      $body = [System.IO.File]::ReadAllBytes($file)
      $size = $body.Length
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      if ($types.ContainsKey($ext)) { $ctype = $types[$ext] } else { $ctype = 'application/octet-stream' }
    } else {
      $msg = $reasons[$code]
      if ($null -eq $msg) { $msg = 'Error' }
      $text = $msg
      if ($code -eq 404) { $text = 'Not found' }
      $body = [System.Text.Encoding]::UTF8.GetBytes($text)
      $size = $body.Length
    }
    $reason = $reasons[$code]
    $hdr = "HTTP/1.1 $code $reason`r`n"
    if ($null -ne $ctype) { $hdr += "Content-Type: $ctype`r`n" }
    $hdr += "Content-Length: $size`r`n$($extra)Cache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($hdr)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -ne 'HEAD' -and $size -gt 0) { $stream.Write($body, 0, $size) }
    $stream.Flush()
    # Read and drop what a refused (too large) body still sends, so closing the socket cannot cut the answer short.
    if ($drain -gt 0) {
      try {
        $client.ReceiveTimeout = 3000
        $sink = New-Object byte[] 65536
        while ($drain -gt 0) {
          $n = $stream.Read($sink, 0, [int][Math]::Min($sink.Length, $drain))
          if ($n -le 0) { break }
          $drain -= $n
        }
      } catch {}
    }
  } catch {
    # A browser may cancel a request half way: ignore it and carry on.
  } finally {
    try { $client.Close() } catch {}
  }
}

$pool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(2, 16)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList

if (-not $NoBrowser) {
  try { Start-Process "http://127.0.0.1:$Port/" } catch {}
}
Write-Host "Amelia's game is open in your browser (http://127.0.0.1:$Port/)."
Write-Host 'To stop it, close this window.'

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($client).AddArgument($root).AddArgument($rootDir).AddArgument($Port).AddArgument($dataDir).AddArgument($lock)
    $handle = $ps.BeginInvoke()
    [void]$jobs.Add(@{ ps = $ps; handle = $handle })
    # Tidy finished handlers.
    if ($jobs.Count -gt 32) {
      for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
        if ($jobs[$i].handle.IsCompleted) {
          $jobs[$i].ps.Dispose()
          $jobs.RemoveAt($i)
        }
      }
    }
  }
} finally {
  $listener.Stop()
  $pool.Close()
}
