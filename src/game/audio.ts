// Sound made in code (no downloaded media): ZzFX effects through Phaser's audio context, and looping tunes that
// cross-fade from place to place (musicplayer.ts).
import type Phaser from 'phaser';
import { ZZFX } from 'zzfx';
import { DWELL, FADE_PLACE, FADE_SCENE, MusicPlayer } from './musicplayer.ts';
import { SFX } from './sfx.ts';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
let lastPlay = new Map<string, number>();
let player: MusicPlayer | null = null;
let override = false;
let placeTune: (() => string) | null = null;
let frame = 0;
/** a tune asked for before the sound woke up */
let early = '';

export const Sound = {
  init(scene: Phaser.Scene): void {
    if (ctx) return;
    const mgr = scene.sound as Phaser.Sound.WebAudioSoundManager;
    ctx = mgr.context ?? new AudioContext();
    master = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(master);
    sfxGain.connect(master);
    master.connect(ctx.destination);
    Sound.volumes(0.6, 0.8);
    lastPlay = new Map();
    player = new MusicPlayer(ctx, musicGain);
    if (early) player.want(early, FADE_SCENE, 0);
  },
  /** Browsers keep audio asleep until a key is pressed. */
  wake(): void {
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  },
  volumes(music: number, sound: number): void {
    if (!ctx || !musicGain || !sfxGain) return;
    musicGain.gain.setTargetAtTime(music * 0.5, ctx.currentTime, 0.1);
    sfxGain.gain.setTargetAtTime(sound, ctx.currentTime, 0.05);
  },
  mute(on: boolean): void {
    if (ctx && master) master.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.05);
  },
  sfx(id: string, vol = 1, pan = 0, rate = 1): void {
    if (!ctx || !sfxGain || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (lastPlay.get(id) ?? -1) < 0.045) return;
    if (!SFX[id]) return;
    lastPlay.set(id, now);
    play(id, now, vol, pan, rate * (0.96 + Math.random() * 0.08));
  },
  /** One recipe played as a quick run of notes (semitones up from its own pitch): jingles, counts, chimes. */
  arp(id: string, semis: readonly number[], gap = 0.08, vol = 1): void {
    if (!ctx || !sfxGain || ctx.state !== 'running' || !SFX[id]) return;
    const now = ctx.currentTime;
    for (let i = 0; i < semis.length; i++) play(id, now + i * gap, vol, 0, 2 ** (semis[i]! / 12));
  },
  /**
   * Play this tune now, over whatever the place plays (a cutscene, a mini-game, the title, the jukebox): a short
   * cross-fade. '' is silence. The place's own tune comes back with place().
   */
  music(id: string): void {
    override = true;
    want(id, FADE_SCENE, 0);
  },
  /**
   * Follow the place: `tune` names the tune for where she stands now and is asked again every few frames, so the
   * music changes at region borders (after DWELL seconds there) with a slow cross-fade.
   */
  place(tune: () => string, fade = FADE_PLACE): void {
    override = false;
    placeTune = tune;
    want(tune(), fade, 0);
  },
  /** Call every frame: follows the place and schedules the tunes a bar ahead of the audio clock. */
  update(): void {
    if (!ctx || !player || ctx.state !== 'running') return;
    frame++;
    if (!override && placeTune && frame % 6 === 0) player.want(placeTune(), FADE_PLACE, DWELL);
    player.tick();
  },
};

function want(id: string, fade: number, dwell: number): void {
  if (player) player.want(id, fade, dwell);
  else early = id;
}

function play(id: string, at: number, vol: number, pan: number, rate: number): void {
  if (!ctx || !sfxGain) return;
  let buf = buffers.get(id);
  if (!buf) {
    const samples = ZZFX.buildSamples(...SFX[id]!);
    buf = ctx.createBuffer(1, samples.length, ZZFX.sampleRate);
    buf.getChannelData(0).set(samples);
    buffers.set(id, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(sfxGain);
  } else src.connect(g).connect(sfxGain);
  src.start(at);
}
