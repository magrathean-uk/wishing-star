# Character finish fallback

This local fallback finishes the existing drawn frames when a new sheet is refused or does not retain a look. It never sends a character image or personal details to a generator. The one neutral material plate was generated from `art/jobs/cast-series-material.json`; its image is `art/masters/cast-series/materials/plate.png`.

Use the approved source frames and their matching current runtime atlases as the baseline, including any mixed imported and older cels. Make an anchor after those sources and atlases have been integrated, then run the finisher against a **new** stage directory. The list can contain one or many cast IDs:

```sh
node tools/art/cast-finish.ts anchor --ids peppa,buzz \
  --baseline art/src --atlas public/assets --out "$TMPDIR/cast-anchor.json"
node tools/art/cast-finish.ts apply --anchor "$TMPDIR/cast-anchor.json" \
  --plate art/masters/cast-series/materials/plate.png \
  --out "$TMPDIR/cast-stage"
```

The anchor hashes every selected frame, character metadata, corresponding atlas page and the whole atlas index. Apply verifies it before, during and after processing; it fails if the inputs have drifted. Use an original baseline each time, never a previous finish as the next baseline. The stage contains processed frames in `src/chars/`, only the selected atlas pages in `assets/chars/`, a full merged index, and `cast-finish-report.json` with changed-pixel and unchanged-frame counts. A failed or incomplete stage is not an output to install.

For each ID `previews/<id>-1x.png` and `-2x.png` show source on the left and finish on the right, at the nominal game view and twice that size; `<id>-blink.gif` alternates the two at game scale. The preview uses the world camera zoom and the character's recorded game scale. Inspect the poses and all relevant facings before accepting any particular ID. The skin, edge and head masks are conservative heuristics, not a substitute for visual review, especially for unusual poses and animals.

The original alpha is checked pixel by pixel. Clip metadata, timing, atlas placement and GPU page dimensions must match the baseline exactly. The existing packer runs only inside the new stage because it deletes unrelated pages in its target. Flat cartoon, mouthless and block looks get only a restrained, uniform colour lift. Toys use separate finishes for plastic, metal, denim and leather. Position and colour masks protect faces, markings and the edges of the dog and horse figures.

Immediately before integrating a reviewed stage, confirm its baseline still matches:

```sh
node tools/art/cast-finish.ts verify --anchor "$TMPDIR/cast-anchor.json"
```

The selected index entries were checked to be unchanged, so keep the current index. With concurrent writes stopped, copy only the selected PNGs and pages, without deleting anything:

```sh
rsync -a --include='*/' --include='*.png' --exclude='*' "$TMPDIR/cast-stage/src/chars/" art/src/chars/
rsync -a --exclude='index.json' "$TMPDIR/cast-stage/assets/chars/" public/assets/chars/
```

If the anchor no longer verifies, create a fresh anchor and stage against the new approved baseline.
