#!/bin/zsh
# Focused check of the Windows launcher's home mode at the HTTP seam (pwsh on this Mac, no browser, no game build).
# The game asks GET /api/players once at boot; the home copy must answer 200 {"players":[]} (as server.js does), not 404.
# Usage: tools/release/check-win-home.sh [port]   (default 4188; temporary game and WS_DATA folders)
set -u
ROOT="${0:A:h:h:h}"
PORT="${1:-4188}"
TMP="$(mktemp -d -t win-home)"
SP=""
cleanup() { [[ -n "$SP" ]] && kill "$SP" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
bye() { echo "WIN HOME CHECK FAIL: $1"; exit 1; }
command -v pwsh >/dev/null || bye "pwsh is not installed"
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && bye "port $PORT is already in use"
mkdir -p "$TMP/rel/game" "$TMP/data"
echo '<!doctype html><title>t</title>' > "$TMP/rel/game/index.html"
cp "$ROOT/tools/release/play-server.ps1" "$TMP/rel/"
WS_DATA="$TMP/data" pwsh -NoProfile -File "$TMP/rel/play-server.ps1" -Port $PORT -NoBrowser > "$TMP/server.log" 2>&1 &
SP=$!
B=http://127.0.0.1:$PORT
for i in {1..80}; do [[ "$(curl -s -o /dev/null -w '%{http_code}' $B/ 2>/dev/null)" == 200 ]] && break; sleep 0.25; done
out="$(curl -s -D - $B/api/players | tr -d '\r')"
print -r -- "$out" | head -1 | grep -q ' 200' || bye "GET /api/players: $(print -r -- "$out" | head -1)"
print -r -- "$out" | grep -qi '^content-type: application/json; charset=utf-8' || bye "/api/players content type is wrong"
[[ "$(print -r -- "$out" | tail -1)" == '{"players":[]}' ]] || bye "/api/players body is wrong"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/players?x=1")" == 200 ]] || bye "/api/players with a query is not 200"
[[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/other)" == 404 ]] || bye "/api/other is not 404"
[[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/home/save/1)" == 404 ]] || bye "empty save slot is not 404"
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data '{"v":1}' $B/api/home/save/1)" == 200 ]] || bye "save PUT is not 200"
[[ "$(curl -s $B/api/home/save/1)" == '{"v":1}' ]] || bye "saved slot did not read back"
[[ -f "$TMP/data/home/slot1.json" ]] || bye "slot1.json was not written to WS_DATA"
redirect="$(curl -s -D - -o /dev/null -H 'Host: localhost:'$PORT $B/api/players | tr -d '\r')"
print -r -- "$redirect" | head -1 | grep -q ' 302' || bye "localhost redirect status is not 302"
loc="$(print -r -- "$redirect" | grep -i '^location:')"
[[ "$loc" == "Location: http://127.0.0.1:$PORT/api/players" ]] || bye "localhost is not sent on to 127.0.0.1 ($loc)"
echo "WIN HOME CHECK OK (port $PORT)"
