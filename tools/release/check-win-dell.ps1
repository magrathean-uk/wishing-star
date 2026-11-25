# Runs on the Dell (Windows PowerShell 5.1), started by tools/release/check-win-dell.sh. Plain ASCII on purpose:
# Windows PowerShell 5.1 reads a script without a byte order mark as ANSI.
# Starts the release folder's "Play Amelia.bat" the way a double-click does (cmd.exe /c, working folder = the
# folder), then checks it over HTTP on 127.0.0.1 and with headless Edge. Prints one "PASS n: ..." or "FAIL n: ..."
# line per check (and "INFO" lines). Always stops what it started. Exit code 0 when every check passed.
param(
  [Parameter(Mandatory = $true)][string]$Rel,
  [Parameter(Mandatory = $true)][string]$Work,
  [string]$Commit = '',
  [int]$Port = 4173
)
$ErrorActionPreference = 'Continue'
$bad = 0
$empty = Join-Path $Work 'empty.txt'
$shot = Join-Path $Work 'title.png'
$profile = Join-Path $Work 'edge-profile'
$data = Join-Path $Rel 'data'
$procs = New-Object System.Collections.ArrayList

function Say([bool]$ok, [string]$n, [string]$text) {
  if ($ok) { Write-Host "PASS $n`: $text" } else { Write-Host "FAIL $n`: $text"; $script:bad++ }
}
function Info([string]$text) { Write-Host "INFO $text" }

# One HTTP request on 127.0.0.1 (never follows a redirect); returns code (0 = no answer) and the body bytes.
function Req([string]$method, [string]$path, [byte[]]$body = $null) {
  $r = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port$path")
  $r.Method = $method
  $r.AllowAutoRedirect = $false
  $r.KeepAlive = $false
  $r.Proxy = $null
  $r.Timeout = 15000
  try {
    if ($null -ne $body) {
      $r.ContentType = 'application/json'
      $r.ContentLength = $body.Length
      $s = $r.GetRequestStream(); $s.Write($body, 0, $body.Length); $s.Close()
    }
    try { $resp = $r.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response }
    if ($null -eq $resp) { return @{ code = 0; bytes = (New-Object byte[] 0) } }
    $ms = New-Object System.IO.MemoryStream
    $st = $resp.GetResponseStream(); $st.CopyTo($ms); $st.Close()
    $code = [int]$resp.StatusCode
    $resp.Close()
    return @{ code = $code; bytes = $ms.ToArray() }
  } catch {
    return @{ code = 0; bytes = (New-Object byte[] 0) }
  }
}
function Same([byte[]]$a, [byte[]]$b) { return ([Convert]::ToBase64String($a) -ceq [Convert]::ToBase64String($b)) }
function Text([byte[]]$b) { return (New-Object System.Text.UTF8Encoding($false)).GetString($b) }

# "Play Amelia.bat" through cmd.exe, hidden, nothing typed (stdin is an empty file, so its "pause" ends at once).
# Drives headless Edge over its debugging port (the page loads 119 MB of art, so a plain --screenshot, which does not wait
# for the network, only ever sees the loading splash): opens the game, waits until window.__game.scene is the title scene,
# lets it settle, saves a screenshot. Returns what it saw.
function Edge-Title([string]$edgeExe, [string[]]$flags, [string]$shotPath, [int]$cdpPort, [int]$waitSecs) {
  $r = @{ ok = $false; secs = 0; scene = ''; errors = ''; gl = ''; note = '' }
  if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $shotPath) { Remove-Item $shotPath -Force -ErrorAction SilentlyContinue }
  $args = @('--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', "--user-data-dir=$profile",
    '--window-size=1920,1080', '--hide-scrollbars', "--remote-debugging-port=$cdpPort") + $flags + 'about:blank'
  $ep = Start-Process -FilePath $edgeExe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Work 'edge.out.txt') -RedirectStandardError (Join-Path $Work 'edge.err.txt')
  $ws = $null
  try {
    $page = $null
    for ($i = 0; $i -lt 40 -and -not $page; $i++) {
      Start-Sleep -Milliseconds 500
      try { $page = (Invoke-RestMethod -Uri "http://127.0.0.1:$cdpPort/json" -TimeoutSec 3) | Where-Object { $_.type -eq 'page' } | Select-Object -First 1 } catch { }
    }
    if (-not $page) { $r.note = 'Edge gave no debugging page'; return $r }
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $cts = New-Object System.Threading.CancellationTokenSource
    [void]$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $cts.Token).GetAwaiter().GetResult()
    $script:cdpId = 0
    function Cdp([string]$method, $params) {
      $script:cdpId++
      $id = $script:cdpId
      $msg = @{ id = $id; method = $method }
      if ($params) { $msg.params = $params }
      $bytes = [Text.Encoding]::UTF8.GetBytes(($msg | ConvertTo-Json -Depth 6 -Compress))
      [void]$ws.SendAsync([ArraySegment[byte]]$bytes, [Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
      while ($true) {
        $buf = New-Object byte[] 65536
        $ms = New-Object IO.MemoryStream
        do {
          $res = $ws.ReceiveAsync([ArraySegment[byte]]$buf, $cts.Token).GetAwaiter().GetResult()
          $ms.Write($buf, 0, $res.Count)
        } until ($res.EndOfMessage)
        $obj = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
        if ($obj.id -eq $id) { return $obj }
      }
    }
    function Js([string]$expr) { $o = Cdp 'Runtime.evaluate' @{ expression = $expr; returnByValue = $true }; return $o.result.result.value }
    $t0 = Get-Date
    [void](Cdp 'Page.navigate' @{ url = "http://127.0.0.1:$Port/" })
    $scene = ''
    while (((Get-Date) - $t0).TotalSeconds -lt $waitSecs) {
      Start-Sleep -Milliseconds 500
      $scene = [string](Js 'String(window.__game && window.__game.scene)')
      if ($scene -like '*Title*') { break }
    }
    $r.scene = $scene
    $r.secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $r.gl = [string](Js "(function(){try{var c=document.createElement('canvas');var g=c.getContext('webgl');if(!g)return 'no webgl';var e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'webgl'}catch(x){return 'error'}})()")
    $r.errors = [string](Js "JSON.stringify((window.__game && window.__game.errors) || [])")
    if ($scene -like '*Title*') {
      Start-Sleep -Seconds 3   # let the title settle
      $shot = Cdp 'Page.captureScreenshot' @{ format = 'png' }
      [IO.File]::WriteAllBytes($shotPath, [Convert]::FromBase64String($shot.result.data))
      $r.ok = $true
    }
  } catch { $r.note = "error: $($_.Exception.Message)" }
  finally {
    if ($ws) { try { $ws.Dispose() } catch { } }
    & taskkill.exe /T /F /PID $ep.Id 2>&1 | Out-Null
    Start-Sleep -Milliseconds 800
    if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
  }
  return $r
}

function Start-Launcher([string]$tag) {
  $bat = Join-Path $Rel 'Play Amelia.bat'
  $o = Join-Path $Work "$tag.out.txt"
  $e = Join-Path $Work "$tag.err.txt"
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList ('/c ""' + $bat + '""') -WorkingDirectory $Rel -WindowStyle Hidden -PassThru -RedirectStandardOutput $o -RedirectStandardError $e -RedirectStandardInput $empty
  [void]$p.Handle   # keeps the handle, so ExitCode is readable after WaitForExit
  [void]$procs.Add($p)
  return $p
}
function Stop-Tree($p) {
  if ($null -eq $p) { return }
  & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null
}
function Wait-Up([int]$seconds) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $seconds) {
    $r = Req 'GET' '/'
    if ($r.code -eq 200) { return [math]::Round(((Get-Date) - $t0).TotalSeconds, 1) }
    Start-Sleep -Milliseconds 250
  }
  return -1
}
function Wait-Down([int]$seconds) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $seconds) {
    if ($null -eq (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}
function Server-Procs { return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*play-server.ps1*' }) }
function Slot-Files { if (Test-Path (Join-Path $data 'home')) { return @(Get-ChildItem (Join-Path $data 'home') -Filter 'slot*.json' -File) } else { return @() } }
function Hist-Files([string]$pattern) {
  $h = Join-Path $data 'home\history'
  if (Test-Path $h) { return @(Get-ChildItem $h -Filter $pattern -File) } else { return @() }
}
function Data-Hash {
  if (-not (Test-Path $data)) { return 'none' }
  $lines = Get-ChildItem $data -Recurse -File | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($data.Length) + ' ' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
  return ($lines -join "`n")
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null
Set-Content -Path $empty -Value '' -Encoding ASCII
if (Test-Path $shot) { Remove-Item $shot -Force }

# ---- the machine, for the report ----
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
$gpu = (Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join '; '
$os = Get-CimInstance Win32_OperatingSystem
$ram = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Info "hardware: $cpu | $gpu | $ram GB RAM | $($os.Caption) build $($os.BuildNumber)"
Info "shell: Windows PowerShell $($PSVersionTable.PSVersion) | session culture $((Get-Culture).Name), system locale $((Get-WinSystemLocale).Name), UI language $((Get-UICulture).Name) | console code page $([Console]::OutputEncoding.CodePage)"
Info "folder: $Rel"

$p1 = $null
try {
  # A port that something else holds is the environment's fault, not the launcher's: stop early.
  if ($null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    Say $false '1' "port $Port is already in use on the Dell before the start (not touched)"
    exit 1
  }
  if (@(Server-Procs).Count -gt 0) { Say $false '1' 'a play-server.ps1 process is already running on the Dell (not touched)'; exit 1 }
  $msedgeBefore = @(Get-Process msedge -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })

  # ---- 1. the launcher starts via the .bat under Windows PowerShell 5.1 and serves the game ----
  $p1 = Start-Launcher 'first'
  $secs = Wait-Up 40
  $home1 = Req 'GET' '/'
  $pers = Req 'GET' '/personal.json'
  $idx = Text $home1.bytes
  $kids = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p1.Id -and $_.Name -eq 'powershell.exe' })
  $exe = ''
  if ($kids.Count -gt 0) { $exe = $kids[0].ExecutablePath }
  $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $ownerOk = ($null -ne $owner -and $kids.Count -gt 0 -and $owner.OwningProcess -eq $kids[0].ProcessId)
  $ver = Join-Path $Rel 'VERSION.txt'
  $verText = ''
  if (Test-Path $ver) { $verText = (Get-Content $ver -Raw) }
  $verOk = ($verText -match 'Amelia and the Wishing Star') -and ($Commit -eq '' -or $verText.Contains($Commit))
  $verServed = (Req 'GET' '/VERSION.txt').code
  $ok1 = ($secs -ge 0) -and ($home1.code -eq 200) -and ($idx -match '<title') -and ($pers.code -eq 200) -and ($exe -like '*\WindowsPowerShell\v1.0\powershell.exe') -and $ownerOk -and $verOk
  Say $ok1 '1' ("Play Amelia.bat via cmd.exe: up in ${secs}s, GET / $($home1.code) ($($home1.bytes.Length) bytes), personal.json $($pers.code), server = $exe (listener pid match: $ownerOk), VERSION.txt on disk: $verOk, GET /VERSION.txt $verServed (the server only serves game\)")
  if ($ok1 -eq $false) {
    Info ("first.out: " + ((Get-Content (Join-Path $Work 'first.out.txt') -ErrorAction SilentlyContinue) -join ' | '))
    Info ("first.err: " + ((Get-Content (Join-Path $Work 'first.err.txt') -ErrorAction SilentlyContinue) -join ' | '))
  }
  $firstPid = $kids[0].ProcessId

  # ---- 2. save round trip through the home save API ----
  # Hungarian letters in the save, as a real name on a hu-HU laptop could carry (built from code points: ASCII file).
  $hun = ([string][char]0x00C1) + [char]0x0151 + [char]0x0171 + [char]0x00E9
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $s1 = $utf8.GetBytes('{"v":1,"test":"wishing-star dell check","name":"' + $hun + '","n":1}')
  $s1b = $utf8.GetBytes('{"v":1,"test":"wishing-star dell check","name":"' + $hun + '","n":2}')
  $pre = Req 'GET' '/api/home/save/1'
  $put = Req 'PUT' '/api/home/save/1' $s1
  $get = Req 'GET' '/api/home/save/1'
  $slotDisk = Join-Path $data 'home\slot1.json'
  $diskOk = (Test-Path $slotDisk) -and (Same ([System.IO.File]::ReadAllBytes($slotDisk)) $s1)
  $hist1 = @(Hist-Files 'slot1-*.json' | Where-Object { $_.Name -notlike '*-deleted*' })
  $histOk = ($hist1.Count -eq 1) -and (Same ([System.IO.File]::ReadAllBytes($hist1[0].FullName)) $s1)
  $put2 = Req 'PUT' '/api/home/save/1' $s1b
  $get2 = Req 'GET' '/api/home/save/1'
  $hist2 = @(Hist-Files 'slot1-*.json' | Where-Object { $_.Name -notlike '*-deleted*' })
  $histKept = ($hist2.Count -eq 1) -and (Same ([System.IO.File]::ReadAllBytes($hist2[0].FullName)) $s1)
  $bad1 = (Req 'PUT' '/api/home/save/1' ($utf8.GetBytes('not json'))).code
  $get3 = Req 'GET' '/api/home/save/1'
  $del = Req 'DELETE' '/api/home/save/1'
  $gone = Req 'GET' '/api/home/save/1'
  $moved = @(Hist-Files 'slot1-*-deleted*.json')
  $movedOk = ($moved.Count -eq 1) -and (Same ([System.IO.File]::ReadAllBytes($moved[0].FullName)) $s1b)
  $ok2 = ($pre.code -eq 404) -and ($put.code -eq 200) -and ($get.code -eq 200) -and (Same $get.bytes $s1) -and $diskOk -and $histOk `
    -and ($put2.code -eq 200) -and (Same $get2.bytes $s1b) -and $histKept -and ($bad1 -eq 400) -and (Same $get3.bytes $s1b) `
    -and ($del.code -eq 200) -and ($gone.code -eq 404) -and (-not (Test-Path $slotDisk)) -and $movedOk
  Say $ok2 '2' "slot 1: empty first ($($pre.code)), PUT $($put.code), read back byte-identical $(Same $get.bytes $s1), on disk identical $diskOk, history file identical $histOk, second PUT $($put2.code) read back $(Same $get2.bytes $s1b) with first history kept $histKept, bad save refused $bad1 and slot unchanged $(Same $get3.bytes $s1b), DELETE $($del.code) then GET $($gone.code), moved aside intact $movedOk"

  # ---- 3. headless Edge (built into Windows 11) loads the title screen ----
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
  if (-not (Test-Path $edge)) {
    Say $false '3' 'msedge.exe not found'
  } else {
    # Its own profile folder under the work folder: nothing of the signed-in browsers is touched. Muted.
    # The Dell's own graphics first (the real case), then Edge's software renderer if that gives no title.
    $t0 = Get-Date
    $edgeTry = @(@{ name = 'default graphics'; flags = @() }, @{ name = 'software renderer'; flags = @('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader') })
    $edgeUsed = ''
    foreach ($try in $edgeTry) {
      $er = Edge-Title $edge $try.flags $shot 9333 45
      Info "edge ($($try.name)): title $($er.ok) after $($er.secs)s, scene '$($er.scene)', webgl '$($er.gl)', game errors $($er.errors) $($er.note)"
      $edgeUsed = $try.name
      if ($er.ok) { break }
    }
    $edgeSecs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $size = 0; $distinct = 0; $white = 1.0; $w = 0; $h = 0
    if (Test-Path $shot) {
      $size = (Get-Item $shot).Length
      Add-Type -AssemblyName System.Drawing
      $bmp = New-Object System.Drawing.Bitmap $shot
      $w = $bmp.Width; $h = $bmp.Height
      $seen = @{}; $light = 0; $total = 0
      for ($x = 8; $x -lt $w; $x += [math]::Max(1, [int]($w / 48))) {
        for ($y = 8; $y -lt $h; $y += [math]::Max(1, [int]($h / 27))) {
          $c = $bmp.GetPixel($x, $y); $total++
          $seen[('{0}-{1}-{2}' -f ($c.R -shr 3), ($c.G -shr 3), ($c.B -shr 3))] = 1
          if ($c.R -gt 235 -and $c.G -gt 235 -and $c.B -gt 235) { $light++ }
        }
      }
      $bmp.Dispose()
      $distinct = $seen.Count
      if ($total -gt 0) { $white = [math]::Round($light / $total, 2) }
    }
    # An error page is a small, mostly white picture; the title screen is a full-size picture with many colours.
    $ok3 = (Test-Path $shot) -and ($w -ge 1280) -and $er.ok -and ($size -gt 100000) -and ($distinct -ge 40) -and ($white -lt 0.5)
    Say $ok3 '3' "headless Edge ($edgeUsed) reached the title scene in $($er.secs)s, screenshot ${w}x${h}, $size bytes, $distinct colour buckets in the sample, $white of it near white, took ${edgeSecs}s (the picture itself is fetched and read by the Mac script)"
  }

  # ---- 4. second start while the first runs (Amelia double-clicks twice) ----
  $s2 = $utf8.GetBytes('{"v":1,"test":"wishing-star dell check","slot":2}')
  [void](Req 'PUT' '/api/home/save/2' $s2)
  $before = Data-Hash
  $t0 = Get-Date
  $p2 = Start-Launcher 'second'
  $exited = $p2.WaitForExit(60000)
  $secs2 = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $code2 = -1
  if ($exited) { $code2 = $p2.ExitCode }
  $out2 = (Get-Content (Join-Path $Work 'second.out.txt') -ErrorAction SilentlyContinue) -join ' | '
  if (-not $exited) { Stop-Tree $p2 }
  $stillUp = Req 'GET' '/'
  $stillSave = Req 'GET' '/api/home/save/2'
  $ownerNow = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $same = ($null -ne $ownerNow) -and ($ownerNow.OwningProcess -eq $firstPid)
  $after = Data-Hash
  $servers = @(Server-Procs).Count
  # the .bat ends with a pause, so its own exit code is 0 or 1; what matters is the message and that the first is untouched
  $ok4 = $exited -and ($out2 -match 'other Play Amelia') -and ($stillUp.code -eq 200) -and ($stillSave.code -eq 200) -and (Same $stillSave.bytes $s2) -and $same -and ($before -ceq $after) -and ($servers -eq 1)
  Say $ok4 '4' "second start ended itself after ${secs2}s (exit code $code2, says: '$out2'); first still serves ($($stillUp.code)), same listener pid $same, one server process ($servers), slot 2 save intact $(Same $stillSave.bytes $s2), data folder unchanged $($before -ceq $after)"

  # ---- 5. stop, clean start again, the saves are as left, then remove them: the save area is empty of our data ----
  Stop-Tree $p1
  $down = Wait-Down 15
  $left = @(Server-Procs).Count
  $p3 = Start-Launcher 'third'
  $secs3 = Wait-Up 40
  $persist = Req 'GET' '/api/home/save/2'
  $del2 = Req 'DELETE' '/api/home/save/2'
  $codes = @((Req 'GET' '/api/home/save/1').code, (Req 'GET' '/api/home/save/2').code, (Req 'GET' '/api/home/save/3').code)
  $slots = @(Slot-Files).Count
  Stop-Tree $p3
  $down3 = Wait-Down 15
  $left3 = @(Server-Procs).Count
  # remove what the check wrote (the moved-aside copies in data\home\history included): the folder is ours
  if (Test-Path $data) { Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue }
  $dataGone = -not (Test-Path $data)
  $ok5 = $down -and ($left -eq 0) -and ($secs3 -ge 0) -and ($persist.code -eq 200) -and (Same $persist.bytes $s2) -and ($del2.code -eq 200) `
    -and (($codes -join ',') -eq '404,404,404') -and ($slots -eq 0) -and $down3 -and ($left3 -eq 0) -and $dataGone
  Say $ok5 '5' "stop freed the port $down (server processes left $left), clean start up in ${secs3}s, slot 2 kept across the restart $(Same $persist.bytes $s2), removed (DELETE $($del2.code)), slots 1 to 3 read $($codes -join ','), slot files on disk $slots, stopped again (port free $down3, processes left $left3), data folder removed $dataGone"
} finally {
  # Whatever happens, nothing of ours keeps running.
  foreach ($p in $procs) { if (-not $p.HasExited) { Stop-Tree $p } }
  foreach ($s in Server-Procs) { & taskkill.exe /T /F /PID $s.ProcessId 2>&1 | Out-Null }
  # A browser the launcher's Start-Process may have started in this (service) session: report, and stop it.
  $stray = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $msedgeBefore -notcontains $_.ProcessId -and ($_.SessionId -eq 0 -or $_.CommandLine -like "*$Work*") })
  if ($stray.Count -gt 0) {
    Info "browser processes started during the run (session 0 or our profile): $($stray.Count); stopped"
    foreach ($s in $stray) { & taskkill.exe /F /PID $s.ProcessId 2>&1 | Out-Null }
  } else { Info 'no browser process was started by the launcher in this session' }
  if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($bad -eq 0) { Write-Host 'DELL DRIVER OK' } else { Write-Host "DELL DRIVER FAIL ($bad)" }
exit $(if ($bad -eq 0) { 0 } else { 1 })
