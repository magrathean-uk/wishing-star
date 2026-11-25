#!/bin/zsh
# Checks the Windows launcher script (play-server.ps1) with pwsh on this Mac, on port 4190, without a browser window.
# Usage: tools/release/check-win.sh [path-to-game-folder-or-dist]
#   default: release/Amelia and the Wishing Star/ (uses its game folder and its copy of the script)
#   given:   a built dist folder (the script from tools/release is used with a temporary game link)
# Compares the full-game load time with the macOS server (server.js under node) on port 4191.
set -u
ROOT="${0:A:h:h:h}"
PORT=4190
MPORT=4191
HL="$HOME/.agents/skills/plan/scripts/hostload.sh"
TMP="$(mktemp -d -t win-check)"
SP=""; MP=""
fail=""
cleanup() {
  [[ -n "$SP" ]] && kill "$SP" 2>/dev/null
  [[ -n "$MP" ]] && kill "$MP" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
bye() { echo "WIN CHECK FAIL: $1"; exit 1; }

command -v pwsh >/dev/null || bye "pwsh is not installed"
if [[ -n "${1:-}" ]]; then
  SRC="${1:A}"
  [[ -f "$SRC/index.html" ]] || bye "no index.html in $SRC"
  mkdir -p "$TMP/rel"; ln -s "$SRC" "$TMP/rel/game"; cp "$ROOT/tools/release/play-server.ps1" "$TMP/rel/"
  REL="$TMP/rel"
else
  REL="$ROOT/release/Amelia and the Wishing Star"
  [[ -f "$REL/play-server.ps1" && -d "$REL/game" ]] || bye "no play-server.ps1 in $REL (run node tools/release/build.ts)"
  [[ -f "$REL/Play Amelia.bat" ]] || bye "no Play Amelia.bat in $REL"
  [[ "$(head -c 200 "$REL/Play Amelia.bat" | grep -c $'\r')" -ge 2 ]] || bye "Play Amelia.bat does not have CRLF line ends"
fi
GAME="$REL/game"
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && bye "port $PORT is already in use"
lsof -nP -iTCP:$MPORT -sTCP:LISTEN >/dev/null 2>&1 && bye "port $MPORT is already in use"

WS_DATA="$TMP/win-data" pwsh -NoProfile -File "$REL/play-server.ps1" -Port $PORT -NoBrowser > "$TMP/server.log" 2>&1 &
SP=$!
up=0
for i in {1..60}; do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/ 2>/dev/null)" == 200 ]] && { up=1; break; }
  sleep 0.25
done
[[ $up -eq 1 ]] || { cat "$TMP/server.log"; bye "the server did not answer on port $PORT"; }

code() { curl -s -o /dev/null -w '%{http_code}' --path-as-is "$@"; }
B=http://127.0.0.1:$PORT
[[ "$(code $B/)" == 200 ]] || fail="/ is not 200"
[[ -z "$fail" && "$(code $B/personal.json)" == 200 ]] || fail="${fail:-personal.json is not 200}"
if [[ -z "$fail" ]]; then
  ct="$(curl -s -D - -o /dev/null $B/personal.json | tr -d '\r')"
  print -r -- "$ct" | grep -qi '^content-type: application/json; charset=utf-8' || fail="personal.json content type is wrong"
  print -r -- "$ct" | grep -qi '^cache-control: no-store' || fail="${fail:-no-store header is missing}"
fi
[[ -z "$fail" && "$(code $B/no-such-file.txt)" == 404 ]] || fail="${fail:-a missing file is not 404}"
if [[ -z "$fail" ]]; then
  for p in '/../x' '/a/../../x' '/%2e%2e/x' '/%2E%2E%2Fx' '/..%5Cx' '/a%5C..%5Cx' '/a%00b' '/%2e%2e%5c%2e%2e%5cwindows/win.ini' '/C:/Windows/win.ini'; do
    c="$(code "$B$p")"
    [[ "$c" == 403 || "$c" == 400 || "$c" == 404 ]] || { fail="refused path $p gave $c"; break; }
    # it must never be a 200
  done
fi
if [[ -z "$fail" ]]; then
  # Every refused path must be 403 or 400 (404 is not enough for the ones that leave game)
  for p in '/../x' '/%2e%2e/x' '/..%5Cx' '/a%00b'; do
    c="$(code "$B$p")"
    [[ "$c" == 403 || "$c" == 400 ]] || { fail="path $p should be refused but gave $c"; break; }
  done
fi
if [[ -z "$fail" ]]; then
  h="$(curl -s -I $B/ | tr -d '\r')"
  print -r -- "$h" | head -1 | grep -q ' 200' || fail="HEAD / is not 200"
  [[ -z "$(curl -s -I $B/ | tr -d '\r' | sed '1,/^$/d')" ]] || fail="${fail:-HEAD returned a body}"
  [[ "$(curl -s -X POST -o /dev/null -w '%{http_code}' $B/)" == 405 ]] || fail="${fail:-POST is not 405}"
fi
# body must match the file byte for byte
if [[ -z "$fail" ]]; then
  big="$(find "$GAME/" -type f -size +200k 2>/dev/null | head -1)"
  [[ -z "$big" ]] && big="$GAME/index.html"
  rel="${big#$GAME/}"
  curl -s "$B/${rel// /%20}" | cmp -s - "$big" || fail="body of $rel differs from the file"
fi

WIN_S=""; MAC_S=""
if [[ -z "$fail" ]]; then
  t0=$SECONDS
  (cd "$ROOT" && "$HL" run --label prio-amelia-pkg36-win -- node tools/bot/smoke.ts --url "http://127.0.0.1:$PORT/" --only chromium > "$TMP/smoke-win.out" 2>&1)
  WIN_S=$((SECONDS - t0))
  grep -q 'SMOKE OK' "$TMP/smoke-win.out" || { tail -5 "$TMP/smoke-win.out"; fail="the smoke run against the PowerShell server failed"; }
fi
if [[ -z "$fail" ]]; then
  # The same run on the macOS server (server.js under node, serving the same game folder).
  mkdir -p "$TMP/mac"; ln -s "$GAME" "$TMP/mac/game"; cp "$ROOT/tools/release/"{server.js,room.js} "$TMP/mac/"
  WS_PORT="$MPORT" WS_DATA="$TMP/mac-data" node "$TMP/mac/server.js" > "$TMP/mac.log" 2>&1 &
  MP=$!
  sleep 1
  t0=$SECONDS
  (cd "$ROOT" && "$HL" run --label prio-amelia-pkg36-mac -- node tools/bot/smoke.ts --url "http://127.0.0.1:$MPORT/" --only chromium > "$TMP/smoke-mac.out" 2>&1)
  MAC_S=$((SECONDS - t0))
  grep -q 'SMOKE OK' "$TMP/smoke-mac.out" || fail="the smoke run against the macOS server failed"
  echo "load: PowerShell server ${WIN_S}s, macOS server ${MAC_S}s (whole smoke run, includes waiting for a heavy slot)"
  grep -h 'SMOKE OK' "$TMP/smoke-win.out" "$TMP/smoke-mac.out"
fi

kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null; SP=""
for i in {1..40}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && fail="${fail:+$fail; }port $PORT is still in use after stopping"
[[ -n "$fail" ]] && bye "$fail"
echo "WIN CHECK OK"
