#!/bin/sh
# Make every missing cast model, then every missing animation sheet, then slice and pack what exists.
# Run under run-job from the repo root. Safe to run again: finished images are skipped.
set -u
cd "$(dirname "$0")/../.." || exit 1
node tools/art/castjobs.ts models
node tools/art/gen.ts art/jobs/models.jobs.json --jobs 4 --tries 5
node tools/art/castjobs.ts sheets
node tools/art/gen.ts art/jobs/sheets.jobs.json --jobs 4 --tries 4
node tools/art/process.ts chars
node tools/art/pack.ts
echo "cast run finished"
