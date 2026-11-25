import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-ext-700.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-ext-600.css';
import Phaser from 'phaser';
import type { Game } from './core/types.ts';
import { installDebug } from './debug/debug.ts';
import { installDisplay } from './game/display.ts';
import { calmFullscreen } from './game/fullscreen.ts';
import { onLeave } from './game/net.ts';
import { saveOnLeave } from './game/save.ts';
import { Boot } from './game/scenes/Boot.ts';
import { HeroSelect } from './game/scenes/HeroSelect.ts';
import { Title } from './game/scenes/Title.ts';
import { UI } from './game/scenes/UI.ts';
import { World } from './game/scenes/World.ts';
import { installTouch, phoneCard } from './game/touch.ts';

async function start(): Promise<void> {
  // a phone gets one calm card instead of the game (D72: iPad or laptop)
  if (phoneCard()) return;
  calmFullscreen();
  // Fonts must be in before Phaser draws any text, with the Hungarian letters Dad's words may use (no word of his
  // lives in the bundle: D67).
  const sample = 'Aa áéíóöőúüű ÁÉÍÓÖŐÚÜŰ';
  await Promise.all([
    document.fonts.load('700 24px Nunito', sample),
    document.fonts.load('600 48px Fredoka', sample),
  ]).catch(() => undefined);
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    width: 1920,
    height: 1080,
    backgroundColor: '#10131f',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
      batchSize: 4096,
    },
    // The game uses Canvas-generated textures, not Phaser's pre/post-FX pipelines.
    disablePreFX: true,
    disablePostFX: true,
    fps: { target: 60, smoothStep: false, forceSetTimeOut: false },
    disableContextMenu: true,
    autoFocus: true,
    input: { keyboard: { capture: [32, 37, 38, 39, 40, 9, 8, 191] }, gamepad: false, mouse: false, touch: false },
    audio: { disableWebAudio: false },
    banner: false,
    scene: [Boot, Title, HeroSelect, World, UI],
  });
  installDisplay(game);
  installDebug(game);
  // on an iPad: the stick and buttons, taps on menus, the turn card (package 65); nothing on a laptop
  installTouch(game);
  // Fit the canvas whenever the window changes (and once more after start, in case the page opened hidden or tiny).
  const refit = () => game.scale.refresh();
  window.addEventListener('resize', refit);
  document.addEventListener('visibilitychange', refit);
  new ResizeObserver(refit).observe(document.getElementById('game')!);
  game.events.once('ready', refit);
  setTimeout(refit, 400);
  // Keep the keyboard: focus the game on any click or key, and forget held keys when the window loses focus.
  window.addEventListener('click', () => {
    // not while the password's hidden box has the iPad's keyboard
    if (!(document.activeElement instanceof HTMLInputElement)) game.canvas.focus();
  });
  window.addEventListener('blur', () => {
    for (const sc of game.scene.getScenes(true)) sc.input.keyboard?.resetKeys();
  });
  document.addEventListener('visibilitychange', () => {
    const ctx = (game.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  // The page is hidden or closing: the game being played is saved first, so play since the last autosave is kept
  // (net.ts then sends every save that waits). Only while a game is open: the title has nothing to save.
  onLeave.save = () => {
    const g = game.registry.get('game') as Game | undefined;
    if (g && game.scene.isActive('World')) saveOnLeave(g);
  };
  // an iPad drops a page it has hidden: the sound stops at once
  window.addEventListener('pagehide', () => {
    const ctx = (game.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (ctx) void ctx.suspend();
  });
}
void start();
