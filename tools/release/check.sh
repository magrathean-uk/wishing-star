#!/bin/zsh
# Checks the release folder the way G will use it, without opening a browser window on his screen:
# runs "Play Amelia.command" with `open` replaced by a recorder, waits for the game to answer on 127.0.0.1:4173,
# runs the Chromium smoke run against it (headless, muted), stops the launcher and checks the port is free again.
# Usage: tools/release/check.sh [--quick]   (--quick skips the smoke run)
# RELEASE_CHECK_PORT=<port> runs the launcher's server on that port instead (WS_PORT), so the check can run while G's
# own game holds 4173 (21 Nov 2026: a candidate run used to take his game down for over an hour). The launcher still
# opens the 4173 address, and that is still checked.
set -u
P="${RELEASE_CHECK_PORT:-4173}"
ROOT="${0:A:h:h:h}"
REL="$ROOT/release/Amelia and the Wishing Star"
[[ -x "$REL/Play Amelia.command" ]] || { echo "RELEASE CHECK FAIL: no launcher in $REL"; exit 1; }
if lsof -nP -iTCP:$P -sTCP:LISTEN >/dev/null 2>&1; then
  echo "RELEASE CHECK FAIL: port $P is already in use:"; lsof -nP -iTCP:$P -sTCP:LISTEN | tail -1; exit 1
fi
FAKE="$(mktemp -d -t release-check)"
print -r -- '#!/bin/zsh' > "$FAKE/open"
print -r -- "print -r -- \"\$@\" >> \"$FAKE/opened\"" >> "$FAKE/open"
chmod +x "$FAKE/open"
# the home copy's second copy of the saves (package 80) goes to a temporary folder, never into the release folder
PATH="$FAKE:$PATH" WS_DATA="$FAKE/data" WS_PORT="$P" "$REL/Play Amelia.command" > "$FAKE/launcher.log" 2>&1 &
LP=$!
ok=0
for i in {1..60}; do
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$P/ 2>/dev/null | grep -q 200; then ok=1; break; fi
  sleep 0.25
done
fail=""
[[ $ok -eq 1 ]] || fail="the game did not answer on 127.0.0.1:$P"
if [[ -z "$fail" ]]; then
  # the launcher opens the browser a moment after the server answers
  for i in {1..40}; do grep -q '127.0.0.1:4173' "$FAKE/opened" 2>/dev/null && break; sleep 0.25; done
  grep -q '127.0.0.1:4173' "$FAKE/opened" 2>/dev/null || fail="the launcher did not open the browser"
fi
[[ -z "$fail" ]] && { curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$P/personal.json | grep -q 200 || fail="personal.json is not served"; }
# the new routes, on the real server: keep, give back, move aside, and the one address
if [[ -z "$fail" ]]; then
  S='{"v":3,"check":1}'
  [[ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -d "$S" http://127.0.0.1:$P/api/home/save/3)" == 200 ]] || fail="the home copy did not take a save"
  [[ "$(curl -s http://127.0.0.1:$P/api/home/save/3)" == "$S" ]] || fail="${fail:+$fail; }the home copy did not give the save back"
  [[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:$P/api/home/save/3)" == 200 ]] || fail="${fail:+$fail; }the home copy did not move the save aside"
  [[ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://localhost:$P/)" == "302 http://127.0.0.1:$P/" ]] || fail="${fail:+$fail; }localhost is not sent on to 127.0.0.1"
fi
if [[ -z "$fail" && "${1:-}" != "--quick" ]]; then
  (cd "$ROOT" && node tools/bot/smoke.ts --only chromium --url "http://127.0.0.1:$P/" 2>&1 | tail -1) | tee "$FAKE/smoke.out"
  grep -q 'SMOKE OK' "$FAKE/smoke.out" || fail="the smoke run against the release folder failed"
fi
kill -TERM $LP 2>/dev/null
for i in {1..40}; do lsof -nP -iTCP:$P -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
if lsof -nP -iTCP:$P -sTCP:LISTEN >/dev/null 2>&1; then fail="${fail:+$fail; }port $P is still in use after the launcher was closed"; fi
if [[ -n "$fail" ]]; then echo "RELEASE CHECK FAIL: $fail"; cat "$FAKE/launcher.log"; rm -rf "$FAKE"; exit 1; fi
rm -rf "$FAKE"
echo "RELEASE CHECK OK ($(head -3 "$REL/VERSION.txt" | tr '\n' ' '))"
