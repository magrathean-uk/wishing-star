#!/bin/zsh
# Proves the home copy starts and saves on the real Windows laptop (G's Dell, `ssh win`), not only under pwsh on this Mac.
# Usage: tools/release/check-win-dell.sh [--rev <commit>] [--folder <release folder>] [--keep]
#   --rev c        the commit to build (default: main). Built in a clean worktree: npm ci, tools/release/build.ts.
#   --folder dir   use a release folder that is already built ("Amelia and the Wishing Star"), skip the build. Only the
#                  Windows parts are needed (game/, play-server.ps1, Play Amelia.bat, VERSION.txt). While the Mac is on a
#                  load hold (D108) build it on the Civo box instead, from a checkout with node_modules linked:
#                    tools/lead/civo-test.sh --src <checkout> [--get rel87] -- bash -c 'npm run build &&
#                      node tools/release/build.ts --windows-only --build 0 && cp -r "release/Amelia and the Wishing Star" rel87'
#                  then `check-win-dell.sh --folder civo-results/wishing-star/rel87`. (civo-test.sh itself has no --get yet:
#                  add it, or call civo-run with --get on the staged copy.) The copy there holds a stand-in personal.json.
#   --keep         leave C:\dev\work\wishing-star on the Dell (default: it is cleaned with win-run clean)
# What it does: builds the release folder from the commit in your job folder, copies it (without the Mac program,
# the Mac launcher, players-seed.json and any data folder) to C:\dev\work\wishing-star\rel on the Dell, and runs
# tools/release/check-win-dell.ps1 there under Windows PowerShell 5.1: "Play Amelia.bat" started through cmd.exe the way
# a double-click does, then
#   1 starts and serves   2 save round trip   3 headless Edge shows the title   4 second start   5 stop, clean start, empty
# Prints one PASS or FAIL line per check, fetches the Edge screenshot back, cleans the Dell, exits 0 only if all passed.
# The Dell keeps its hu-HU locale and code page 852 (the real case). Nothing is changed on it: no firewall, Defender,
# UAC, account, sshd or update setting, and the signed-in browsers and the other Windows user's profile are not touched. Port 4173 on the
# Dell (the launcher's own). It never runs from 22:45 to 07:30 UK time.
# Machine facts: the Windows host notes in ~/dev/records. G, 25 Nov 2026 (package 87).
set -u
setopt pipefail no_bg_nice

HERE="${0:A:h:h:h}"
MAIN="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)"; MAIN="${MAIN:h}"
REV="main"; FOLDER=""; KEEP=0
while (( $# )); do
  case "$1" in
    --rev) REV="${2:?}"; shift 2 ;;
    --folder) FOLDER="${2:?}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "usage: tools/release/check-win-dell.sh [--rev <commit>] [--folder <release folder>] [--keep]"; exit 2 ;;
  esac
done

WORK="${CLEAN_DEV_WORK:-/Volumes/4TB/dev/work}"
STAMP="$(date -u +%H%M)"
JOB="$WORK/jobs/wishing-star/dell-$STAMP"
WT="$WORK/worktrees/wishing-star/dell-$STAMP"
HOSTLOAD="$HOME/.agents/skills/plan/scripts/hostload.sh"
NAME="Amelia and the Wishing Star"
WROOT='C:\dev\work\wishing-star'          # the only place on the Dell
WREL="$WROOT\\rel\\$NAME"
SSHO=(-o BatchMode=yes -o ConnectTimeout=15)
mkdir -p "$JOB"
exec > >(tee -a "$JOB/log.txt") 2>&1
say() { print -r -- "[$(date -u +%H:%M:%S)] $*"; }
CLEAN_NEEDED=0
# stops any play-server.ps1 still running on the Dell (sent as -EncodedCommand: no quoting through cmd.exe)
STOPCMD="$(print -rn -- 'Get-CimInstance Win32_Process -Filter "Name=''powershell.exe''" | Where-Object { $_.CommandLine -like ''*play-server.ps1*'' } | ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }' | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')"
cleanup() {
  local rc=$?
  if (( CLEAN_NEEDED )); then
    # stop anything of ours still running on the Dell, then remove the work folder
    ssh "${SSHO[@]}" win "powershell.exe -NoProfile -EncodedCommand $STOPCMD" >/dev/null 2>&1
    if (( KEEP )); then say "kept $WROOT on the Dell (--keep)"; else
      win-run clean wishing-star >/dev/null 2>&1 && say "win-run clean wishing-star: done" || say "WARNING: win-run clean wishing-star failed"
      say "win-run du: $(win-run du 2>&1 | tr '\n' ' ')"
    fi
  fi
  [[ -d "$WT" ]] && git -C "$MAIN" worktree remove --force "$WT" >/dev/null 2>&1
  exit $rc
}
trap cleanup EXIT
bye() { say "DELL CHECK FAIL: $1"; exit 1; }

# Never between 22:45 and 07:30 UK (the Dell runs G's night jobs).
UK="$(TZ=Europe/London date +%H%M)"
if (( 10#$UK >= 2245 || 10#$UK < 730 )); then bye "it is $UK UK time: no Dell work from 22:45 to 07:30"; fi
ssh "${SSHO[@]}" win 'echo up' 2>&1 | grep -q '^up' || bye "ssh win does not answer"

# 1. The release folder.
if [[ -n "$FOLDER" ]]; then
  REL="${FOLDER:A}"
  [[ -f "$REL/play-server.ps1" && -f "$REL/Play Amelia.bat" && -d "$REL/game" ]] || bye "$REL is not a built release folder"
  COMMIT="$(sed -n 's/^Commit: \([0-9a-f]*\).*/\1/p' "$REL/VERSION.txt")"
  say "using the folder $REL (commit ${COMMIT:0:8})"
else
  COMMIT="$(git -C "$HERE" rev-parse --verify "$REV^{commit}")" || bye "no commit $REV"
  export PLAN_HEAVY_SLOTS="${PLAN_HEAVY_SLOTS:-2}" PLAN_LOAD_MAX="${PLAN_LOAD_MAX:-10}" VITEST_MAX_WORKERS=3
  heavy() { local label="$1"; shift; "$HOSTLOAD" run --wait "${DELL_WAIT:-3600}" --label "wishing-star-dell-$label" -- nice -n 15 "$@"; }
  say "building ${COMMIT:0:8} in $WT (job $JOB)"
  git -C "$MAIN" worktree add --detach "$WT" "$COMMIT" >/dev/null 2>&1 || bye "git worktree add $WT"
  (cd "$WT" && nice -n 15 npm ci --no-audit --no-fund >"$JOB/npm-ci.txt" 2>&1) || bye "npm ci (see $JOB/npm-ci.txt)"
  (cd "$WT" && heavy release node tools/release/build.ts --build 0 >"$JOB/release-build.txt" 2>&1) || bye "release build (see $JOB/release-build.txt)"
  REL="$WT/release/$NAME"
  [[ -f "$REL/Play Amelia.bat" ]] || bye "the build made no $REL"
fi
[[ -d "$REL/data" ]] && bye "$REL has a data folder: this check never sends saves"
head -c 400 "$REL/Play Amelia.bat" | grep -q $'\r' || bye "Play Amelia.bat has no CRLF line ends"
say "release folder: $(du -sh "$REL/game" | cut -f1) of game, $(sed -n '2,3p' "$REL/VERSION.txt" | tr '\n' ' ')"

# 2. Copy to the Dell: a fresh C:\dev\work\wishing-star only (tar over ssh; scp -O is the only file protocol there).
CLEAN_NEEDED=1
say "copying to the Dell: $WREL"
ssh "${SSHO[@]}" win "(if exist $WROOT rmdir /s /q $WROOT) & mkdir \"$WREL\" $WROOT\\run" >/dev/null 2>&1
ssh "${SSHO[@]}" win "if not exist $WROOT\\run\\.  exit 1" >/dev/null 2>&1 || bye "could not make $WROOT on the Dell"
# not sent: the Mac program and launcher, the players password seed, any data folder
COPYFILE_DISABLE=1 tar -cf - -C "$REL" --exclude './play-server' --exclude './Play Amelia.command' --exclude './players-seed.json' --exclude './data' . \
  | ssh "${SSHO[@]}" win "tar -xf - -C \"$WREL\"" || bye "the copy to the Dell failed"
scp -O -q "${SSHO[@]}" "$HERE/tools/release/check-win-dell.ps1" "win:C:/dev/work/wishing-star/run/driver.ps1" || bye "could not copy the driver"
say "copied; running the checks under Windows PowerShell 5.1"

# 3. The checks, on the Dell.
rm -f "$JOB/dell.txt"
ssh "${SSHO[@]}" win "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WROOT\\run\\driver.ps1 -Rel \"$WREL\" -Work $WROOT\\run${COMMIT:+ -Commit ${COMMIT:0:12}}" 2>&1 | tr -d '\r' | tee "$JOB/dell.txt"
DRC=${pipestatus[1]}

# 4. The Edge screenshot, back to the Mac.
SHOTDIR="${SHOT_DIR:-$HERE/test-results/pkg87}"
mkdir -p "$SHOTDIR"
if scp -O -q "${SSHO[@]}" "win:C:/dev/work/wishing-star/run/title.png" "$SHOTDIR/dell-title.png" 2>/dev/null; then
  say "screenshot: $SHOTDIR/dell-title.png ($(sips -g pixelWidth -g pixelHeight "$SHOTDIR/dell-title.png" 2>/dev/null | awk '/pixel/{printf "%s ", $2}'))"
else
  say "no screenshot came back"
fi
cp "$SHOTDIR/dell-title.png" "$JOB/" 2>/dev/null
FAILS="$(grep -c '^FAIL ' "$JOB/dell.txt")"
PASSES="$(grep -c '^PASS ' "$JOB/dell.txt")"
(( DRC == 0 && FAILS == 0 && PASSES == 5 )) || bye "$PASSES of 5 checks passed, $FAILS failed, driver exit $DRC (log $JOB/dell.txt)"
say "DELL CHECK OK: 5 of 5 (${COMMIT:0:8})"
