#!/bin/zsh
# A release candidate for Amelia's home copy (the release folder served on 127.0.0.1:4173 by ./play-server).
# Usage: tools/release/candidate.sh <n> [--rev <commit>] [--candidate <m>] [--full]
#   n               the build number (VERSION.txt, notes docs/phase2-notes/build<n>-notes.txt at that commit)
#   --rev c         the commit to build (default: HEAD of the checkout this runs from); it must hold the notes
#   --candidate m   also tag the built commit candidate-<m> (build-<n> is always tagged)
#   --full          also the 30 minute soak and the full npm run verify (night only, 00:00 to 06:00 Mac time)
#   KEEP_LAUNCHER=1 restart ./play-server detached in the release folder after the swap (G's own server on 4173)
# Steps, all in a clean worktree of the commit (never the main checkout): npm ci, the release build
# (tools/release/build.ts), the release launcher check on a spare port (with --full: the 30 minute soak and the full
# npm run verify instead), then a backup of the whole release/ folder to records, the new build copied into the main
# checkout's release folder with every release/*/data left exactly as it is, the data checked byte for byte
# against the backup, and the tags. Any failure before the swap exits non-zero and leaves the old build in place;
# a failure during the swap puts the backup's build files back.
# Heavy steps take a host slot (hostload.sh). Output and log: <jobs>/cand<n>-<HHMM>/ (log.txt).
# G, 22 Nov 2026 (D100): the home copy follows the website. Build the commit CI passed (what magrathean.uk/game serves)
# and swap it in after the launcher check, about 15 minutes. The long gates (soak, frame gate, walking soak) are timing
# checks a busy Mac fails by itself: never in the day, only with --full at night, and only when a change could cost
# frame rate. Start it under run-job.
set -u
setopt pipefail no_bg_nice

N="${1:-}"
[[ "$N" == <-> ]] || { echo "usage: tools/release/candidate.sh <n> [--rev <commit>] [--candidate <m>] [--full]"; exit 2; }
shift
REV="HEAD"
CAND=""
FULL=0
while (( $# )); do
  case "$1" in
    --rev) REV="${2:?}"; shift 2 ;;
    --candidate) CAND="${2:?}"; shift 2 ;;
    --full) FULL=1; shift ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

HERE="${0:A:h:h:h}"
MAIN="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)"; MAIN="${MAIN:h}"
COMMIT="$(git -C "$HERE" rev-parse --verify "$REV^{commit}")" || { echo "CANDIDATE FAIL: no commit $REV"; exit 1; }
WORK="${CLEAN_DEV_WORK:-/Volumes/4TB/dev/work}"
RECORDS="/Volumes/4TB/dev/records/wishing-star"
STAMP="$(date -u +%H%M)"
JOB="$WORK/jobs/wishing-star/cand$N-$STAMP"
WT="$WORK/worktrees/wishing-star/cand$N-$STAMP"
HOSTLOAD="$HOME/.agents/skills/plan/scripts/hostload.sh"
NAME="Amelia and the Wishing Star"
REL="$MAIN/release/$NAME"
NOTES="docs/phase2-notes/build$N-notes.txt"
# spare ports: never 4173 (G's game), 4188 (verify's own), 4190 (WebKit refuses it), 4220 to 4229 (vps.sh)
SOAK_PORT=4196
CHECK_PORT=4195

mkdir -p "$JOB"
exec > >(tee -a "$JOB/log.txt") 2>&1
say() { print -r -- "[$(date -u +%H:%M:%S)] $*"; }
fail() { say "CANDIDATE FAIL: $*"; say "the old build is still in place; worktree kept at $WT"; exit 1; }
# Machine load rules (manager, 22 Nov 2026, ~/dev/planner/manager/machine-load.md): every heavy step in a host slot
# under nice -n 15, at most 3 cores (vitest 3 workers). Day: 2 slots, load gate 10; night (00:00 to 06:00 Mac time)
# 4 and 20 (set PLAN_HEAVY_SLOTS and PLAN_LOAD_MAX before starting). A busy Mac can hold every slot for hours: wait up
# to 3 hours for one (CAND_WAIT seconds).
export PLAN_HEAVY_SLOTS="${PLAN_HEAVY_SLOTS:-2}" PLAN_LOAD_MAX="${PLAN_LOAD_MAX:-10}" VITEST_MAX_WORKERS=3
heavy() { local label="$1"; shift; "$HOSTLOAD" run --wait "${CAND_WAIT:-10800}" --label "wishing-star-cand$N-$label" -- nice -n 15 "$@"; }

say "candidate build $N from ${COMMIT:0:8}; job $JOB"
[[ -d "$REL" ]] || fail "no release folder at $REL"
git -C "$MAIN" rev-parse -q --verify "refs/tags/build-$N" >/dev/null && fail "tag build-$N already exists"
git -C "$MAIN" worktree add --detach "$WT" "$COMMIT" >/dev/null 2>&1 || fail "git worktree add $WT"
cd "$WT" || fail "cd $WT"
[[ -f "$NOTES" ]] || fail "$NOTES is not in ${COMMIT:0:8}"

# 1. Install (no slot, under nice; the first install after a cache wipe downloads again).
say "npm ci"
nice -n 15 npm ci --no-audit --no-fund >"$JOB/npm-ci.txt" 2>&1 || fail "npm ci (see npm-ci.txt)"
nice -n 15 npx playwright install webkit >"$JOB/playwright.txt" 2>&1 || fail "playwright install webkit"

# 2. The release build, into the worktree's own release folder (it builds dist/ there too).
say "release build"
heavy release node tools/release/build.ts --build "$N" --notes "$NOTES" >"$JOB/release-build.txt" 2>&1 \
  || fail "release build (see release-build.txt)"
NEW="$WT/release/$NAME"
grep -q "^Build: $N\$" "$NEW/VERSION.txt" || fail "VERSION.txt does not say Build: $N"
[[ -z "$(git status --porcelain)" ]] || fail "the worktree is not clean after the build: $(git status --porcelain | head -3)"

if (( FULL )); then
# 3. The 30 minute soak against this build on its own port (never 4173: that is G's game and his saves).
say "soak (30 minutes) on $SOAK_PORT"
lsof -nP -iTCP:$SOAK_PORT -sTCP:LISTEN >/dev/null 2>&1 && fail "port $SOAK_PORT is in use"
npx vite preview --outDir dist --port $SOAK_PORT --strictPort --host 127.0.0.1 >"$JOB/soak-server.txt" 2>&1 &
SP=$!
for i in {1..60}; do curl -s -o /dev/null http://127.0.0.1:$SOAK_PORT/ && break; sleep 0.5; done
heavy soak node tools/bot/soak.ts --url "http://127.0.0.1:$SOAK_PORT/" >"$JOB/soak.txt" 2>&1
SOAK=$?
kill $SP 2>/dev/null; wait $SP 2>/dev/null
tail -3 "$JOB/soak.txt"
(( SOAK == 0 )) || fail "soak (see soak.txt)"

# 4. Every gate, the slow ones included; the release launcher check runs the new folder on a spare port.
say "npm run verify"
export RELEASE_CHECK_PORT=$CHECK_PORT
heavy verify npm run verify >"$JOB/verify.txt" 2>&1
VERIFY=$?
cat "$JOB/verify.txt" | tail -30
(( VERIFY == 0 )) && grep -q '^VERIFY PASS' "$JOB/verify.txt" || fail "verify (see verify.txt)"
say "VERIFY PASS"
else
# 3. Quick (default): the launcher starts the new release folder and answers on a spare port. No smoke run: its
# waits are timing checks a loaded Mac fails by itself (22 Nov 2026); the smoke runs in the full verify (--full).
# Not in a slot and not niced: the launcher must answer within 10 seconds, as on Amelia's Mac.
say "release launcher check on $CHECK_PORT"
RELEASE_CHECK_PORT=$CHECK_PORT zsh tools/release/check.sh --quick >"$JOB/release-check.txt" 2>&1 \
  || fail "release check (see release-check.txt)"
tail -2 "$JOB/release-check.txt"
fi

# 5. Backup of the whole release folder (saves included), then the swap with every data/ left alone.
BACKUP="$RECORDS/backup/release-before-$N-$(date -u +%Y%m%dT%H%M%SZ)"
say "backup to $BACKUP"
mkdir -p "$BACKUP" && rsync -a "$MAIN/release/" "$BACKUP/" || fail "backup to $BACKUP"
datasums() { (cd "$1" && find . -path '*/data/*' -type f -print0 | sort -z | xargs -0 shasum -a 256); }
datasums "$BACKUP" >"$JOB/data-before.txt"
restore() {
  say "swap failed: putting the backup's build files back"
  rsync -a --delete --exclude '/data/' "$BACKUP/$NAME/" "$REL/"
}
say "swap: $NEW -> $REL (data/ untouched)"
rsync -a --delete --exclude '/data/' "$NEW/" "$REL/" || { restore; fail "rsync into $REL"; }
(( FULL )) && { cp "$WT/release/soak-report.md" "$MAIN/release/soak-report.md" || { restore; fail "soak report copy"; }; }
grep -q "^Build: $N\$" "$REL/VERSION.txt" || { restore; fail "VERSION.txt in $REL does not say Build: $N"; }

# 6. G's server: restart it so the program matches the new files (detached, so it outlives this run).
if [[ "${KEEP_LAUNCHER:-0}" == 1 ]]; then
  for pid in $(lsof -nP -t -iTCP:4173 -sTCP:LISTEN 2>/dev/null); do
    if [[ "$(lsof -a -p $pid -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" == "$REL" ]]; then
      say "stopping play-server pid $pid"; kill -TERM $pid
    else
      say "port 4173 is held by pid $pid outside the release folder: not touched"
    fi
  done
  for i in {1..40}; do lsof -nP -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
  # its own session, so the end of this run (or of run-job) does not take it down
  (cd "$REL" && perl -MPOSIX -e 'POSIX::setsid(); exec "./play-server" or die' </dev/null >>"$JOB/play-server.txt" 2>&1 &!)
  for i in {1..40}; do [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/)" == 200 ]] && break; sleep 0.25; done
fi

# 7. The checks after the swap: 200 on 4173 with the new page, the saves byte for byte as before.
WARN=""
CODE="$(curl -s -o "$JOB/served-index.html" -w '%{http_code}' http://127.0.0.1:4173/)"
say "4173 answers $CODE"
if [[ "$CODE" == 200 ]]; then
  cmp -s "$JOB/served-index.html" "$REL/game/index.html" && say "4173 serves build $N's index.html" \
    || { say "WARNING: 4173 serves a page that is not build $N's index.html"; WARN=1; }
else
  WARN=1
fi
datasums "$MAIN/release" >"$JOB/data-after.txt"
if cmp -s "$JOB/data-before.txt" "$JOB/data-after.txt"; then
  say "release/*/data byte-identical to the backup ($(wc -l <"$JOB/data-after.txt" | tr -d ' ') files)"
else
  say "WARNING: release/*/data differs from the backup (G playing during the run writes there):"
  diff "$JOB/data-before.txt" "$JOB/data-after.txt"
  WARN=1
fi

# 8. Tags (local) and tidy up.
git -C "$MAIN" tag -m "build $N" "build-$N" "$COMMIT" && say "tag build-$N on ${COMMIT:0:8}"
[[ -n "$CAND" ]] && git -C "$MAIN" tag -m "candidate $CAND" "candidate-$CAND" "$COMMIT" && say "tag candidate-$CAND on ${COMMIT:0:8}"
cd "$JOB" && git -C "$MAIN" worktree remove --force "$WT" && say "worktree removed"
[[ -n "$WARN" ]] && { say "CANDIDATE DONE WITH WARNINGS (above): build $N is in $REL; backup $BACKUP"; exit 3; }
say "CANDIDATE OK: build $N (${COMMIT:0:8}) in $REL; backup $BACKUP"
