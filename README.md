# Amelia and the Wishing Star

A cosy top-down quest game for the browser, made as a Christmas 2026 present. This is the public copy of
its source: Phaser 3 and TypeScript, built with Vite.

A curious creeper blows up the Wishing Star on top of the Great Tree. Seven shards fly across a patchwork
island and mobs start to roam at night. You explore, gather, craft, build a home, help friends and chase the
mobs off to win the shards back, then befriend the lonely Creeper King, rebuild the star and light the tree.
About five hours to the finale. Nothing is ever lost: no game over and no timers that punish.

## Play it
You need Node.js 24 or newer.
```
npm install
npm run dev
```
Then open the address it prints in Chrome. The game is made for a desktop keyboard and also works on an iPad
with on-screen buttons.

| Key | Does |
|---|---|
| Arrow keys or W A S D | Walk |
| Space or Enter | The one action key: talk, pick up, chop, mine, swing, confirm |
| X or Backspace | Back |
| E | Bag (and recipes next to a crafting table or furnace) |
| Q, M, K | Quest book, map, sticker book |
| H | A hint for what to do next |
| B | Build mode at home |
| 1 to 8, R | Pick a hotbar item, use it |
| P or Esc | Pause menu: save, options, how to play |
| F | Full screen |

## Commands
| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build in `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | Lint and format check (Biome) |
| `npm run verify` | The full acceptance run: tests, content checks, a bot that plays the story through, browser smoke tests and a frame-time gate |
| `npm run release` | A double-click release folder with a small local server that keeps a second copy of the saves on disk (see `README_FOR_DAD.md`) |

## How it is laid out
- `src/core`: the game rules as plain TypeScript, with no Phaser, no DOM and no clock or randomness of their own, so they can be tested and replayed.
- `src/game`: scenes, rendering, input, sound and menus (Phaser).
- `src/data`: the content as data: quests, dialogue, items, recipes, the map. `tools/check` validates it.
- `tools/bot`: bots that play the game headless to check the story can be finished, the reading level and the frame rate.
- `tools/art`: the art pipeline that cuts, keys and packs the generated pictures into atlases (`art/src` to `public/assets`).
- `tools/music`: the music, written as code and rendered to audio.

## Make it your own
`src/data/personal.json` holds the hero's family and friends: names, a few lines each and the letters read in the
game. Here it is a stand-in. Dialogue uses tokens such as `{mum}` and `{hero}` filled from that file, and the
release copies it unbundled, so it can be edited without rebuilding.

## What is not here
The family's own words, the saved-game fixtures and the tests that read them, the project's working notes and
the full-size art masters (`art/masters/`).

## Credits
- Engine: [Phaser](https://phaser.io) (MIT). Sound effects: [ZzFX](https://github.com/KilledByAPixel/ZzFX) (MIT).
- Fonts: Fredoka and Nunito, through Fontsource (SIL Open Font Licence).
- Pictures: generated with an AI image model; nothing was copied from official artwork.
- Music: composed as code in `tools/music`. No show music, songs or episode text are used.
- Code, writing and tests: made with AI coding agents (Claude Code and Codex) under one product owner.

## Licence
The code is under the MIT licence (see `LICENSE`). The characters from children's television shows that appear
in the game belong to their owners. This is a non-commercial fan project, not connected with or endorsed by
them; their pictures were generated for a private family present.
