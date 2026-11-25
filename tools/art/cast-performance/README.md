# Cast performance importer

This tool processes art already made for the game. It does not generate art. Run it from the worktree that owns the intended output. Each six-cel sheet uses a 3-column, 2-row grid:

- Top: right-facing side walk, contact A, passing, opposite contact B.
- Bottom: front-facing speech, rest, mid syllable, open or expressive.

Each full figure must fit inside its own cell, with a clear margin. The background must be transparent or near-magenta. The importer checks the border, removes the connected key colour and conservatively removes small enclosed gaps which match the measured border colour. It leaves other pink and purple areas alone and records the bounding boxes of any gaps removed. A costume the same colour as the background cannot be distinguished reliably: use transparency or a different background and review the result.

When a side walk is narrowly wider than the existing canvas, fitting may use one common horizontal shift of at most 3 percent of the frame width and a common scale reduction of at most 3 percent across its cels. The baseline and original canvas stay fixed. The preview reports the adjustment; figures still too wide are rejected rather than cropped.

## Review

```sh
node tools/art/cast-performance/import.ts preview \
  --id bluey --sheet /absolute/path/bluey.png \
  --out "$TMPDIR/bluey-performance.png"
```

The PNG shows the existing and proposed walk and speech cycles with their idle frames at the left. The JSON on stdout contains separate `walk` and `talk` approval hashes, any row errors, and `keyedHoles`. A fixed character gets only its existing front speech clip; a non-speaking character gets only its existing side walk. A bad row does not prevent the other row being reviewed. Reject a row by omitting its hash from the decisions file. No row is accepted just because it passes the structural and motion checks. Compare the new cycles with the existing walk, idle and other facings; check identity, costume, proportions, colour, registration, gaps and animation. Keep the old row where the new one is worse. Review the original sheet too, especially any regions listed in `keyedHoles`.

To prepare many previews, supply a manifest with a `characters` array of `{ "id", "sheet", "walkSheet"? }` entries:

```sh
node tools/art/cast-performance/import.ts preview-batch \
  --manifest /path/sheets.json --out-dir "$TMPDIR/cast-previews"
```

It continues past individual errors and writes a `candidates.json` report beside the comparison PNGs. Exit 1 means at least one eligible row or input needs correction. Candidate hashes are not approval decisions; copy only visually accepted rows into a separate decisions file.

For a six-cel walk, the playback sequence is contact A, passing, contact B, passing. It contains three drawn poses. This can be useful for an intentional held style, but it must not silently replace a better eight-frame walk.

Where eight new walk drawings are available, add `--walk-sheet /absolute/path/bluey-walk.png`. This optional separate sheet is a 4-column, 2-row grid read left to right: contact A, recoil A, passing A, rise A; contact B, recoil B, passing B, rise B. All eight cels must be distinct and pass the existing eight-frame motion gate. They are used as eight drawings in order, with the existing walk timing. The speech row still comes from the six-cel sheet. The walk hash is tied to the eight-cel sheet, and the talk hash to the six-cel sheet.

Hashes also bind the character ID, all currently referenced source frames and metadata, and the importer, image, motion and packer code. A changed sheet, target or pipeline requires a fresh preview and review. The hash is a fingerprint, not automated proof of likeness.

The runtime supports `timing.walk.stepByFacing.side` and `timing.<clip>.dursByFacing`. For an imported four-frame side walk, the importer sets the side contacts to `[0, 2]`; for an eight-frame side walk it uses `[0, 4]`. If inherited timing would hide a new cel or give it less than half the mean frame time, the importer redistributes that facing's durations to make every cel visible, retaining the total cycle length. Global durations and the original facings stay unchanged. When a walk had no valid authored durations and its frame count changes, it records the old 8 fps default cycle and equivalent global contacts, provided the other walk facings had the same frame count. It rejects the row if this would alter another facing's default cycle. The strips show the durations that will be installed and mark foot contacts with `*`. Recreate previews after changing the animation runtime, which is also part of the fingerprint.

## Install approved rows

Create a decisions JSON file. Paths can be absolute or relative to that file. Include only rows actually approved:

```json
{
  "characters": [
    {
      "id": "bluey",
      "sheet": "/path/bluey.png",
      "walkSheet": "/path/bluey-walk.png",
      "approvals": { "walk": "<walk hash>", "talk": "<talk hash>" }
    },
    {
      "id": "potato",
      "sheet": "/path/potato.png",
      "approvals": { "talk": "<talk hash>" }
    }
  ]
}
```

```sh
node tools/art/cast-performance/import.ts install-batch \
  --manifest /path/decisions.json \
  --reports "/Volumes/4TB/dev/records/wishing-star/cast-performance"
```

`walkSheet` and `--reports` are optional. Reports default to `/Volumes/4TB/dev/records/wishing-star/cast-performance`, outside the shipped tree. For one character, `install --id ID --sheet FILE --walk HASH --talk HASH` accepts either or both hashes and also accepts `--walk-sheet` and `--reports`.

The importer stages every selected character in `$TMPDIR`, verifies the changed motion clips, packs one character at a time in isolation and checks that approvals still match. It then updates the source frames and metadata, those characters' production atlas pages, and the shared atlas and motion indexes once. Existing unselected facings, clips, lazy-page aliases and unrelated index entries are retained. It rolls back normal file-write errors; interrupted runs should be inspected before retrying. Source masters are neither changed nor deleted.

Focused verification:

```sh
node --check tools/art/cast-performance/import.ts
node --test tools/art/cast-performance/import.test.ts
```
