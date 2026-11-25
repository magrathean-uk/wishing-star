// A small test and debug surface on window.__game. The bots drive the game through real key events and read state here.
import type Phaser from 'phaser';
import type { Cmd, Game } from '../core/types.ts';
import { art } from '../game/assets.ts';
import type { World } from '../game/scenes/World.ts';

export function installDebug(game: Phaser.Game): void {
  const world = () => game.scene.getScene('World') as World | undefined;
  const api = {
    game,
    get g(): Game | undefined {
      return world()?.g;
    },
    get scene(): string {
      return game.scene
        .getScenes(true)
        .map((s) => s.scene.key)
        .join(',');
    },
    cmd(c: Cmd): void {
      world()?.keys.send(c);
    },
    debug(what: string, arg?: string | number): void {
      world()?.keys.send({ c: 'debug', what, arg });
    },
    perf(): { js: number; steps: number; bytes: typeof art.bytes; actors: number; things: number; fx: number } {
      const w = world();
      return {
        js: w?.jsMs ?? 0,
        steps: w?.stepsRun ?? 0,
        bytes: art.bytes,
        ...(w?.counts() ?? { actors: 0, things: 0, fx: 0 }),
      };
    },
    errors: [] as string[],
  };
  window.addEventListener('error', (e) => api.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => api.errors.push(String(e.reason)));
  (window as unknown as { __game: typeof api }).__game = api;
}
