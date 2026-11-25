// Package 79 (D86): every tune is sound data, long enough not to nag, calm, and every place names one that exists.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { content } from '../src/data/content.ts';
import meet from '../src/data/map/meet.json' with { type: 'json' };
import { regions } from '../src/data/world.ts';
import { barSeconds, loopBars, loopSeconds, MUSIC, midi, NIGHT_REGIONS, readBar } from '../src/game/music.ts';
import { INTERIOR_MUSIC } from '../tools/map/interiors.ts';
import { ROOM_MUSIC } from '../tools/map/rooms.ts';

/** mini-games, cutscene stings and the ending: allowed to loop sooner than 45 seconds */
const SHORT = ['mini', 'sneak', 'concert', 'finale'];

describe('the tunes', () => {
  it('each parses, fills its length in every voice and stays between C2 and C7', () => {
    for (const [id, t] of Object.entries(MUSIC)) {
      const n = loopBars(t);
      expect(t.voices.length, id).toBeGreaterThanOrEqual(2);
      for (const v of t.voices) {
        expect(v.bars.length, `${id} ${v.name}`).toBe(n);
        for (const bar of v.bars) {
          const steps = bar.trim().split(/\s+/);
          expect(steps.length, `${id} ${bar}`).toBeGreaterThan(0);
          expect(steps[0] === '-', `${id}: a bar may not start by holding: ${bar}`).toBe(false);
          for (const s of steps) {
            if (s === '.' || s === '-') continue;
            for (const name of s.replace(/[\^_]$/, '').split('+')) {
              const m = midi(name);
              expect(Number.isNaN(m), `${id}: bad note ${name}`).toBe(false);
              expect(m, `${id}: ${name}`).toBeGreaterThanOrEqual(midi('C2'));
              expect(m, `${id}: ${name}`).toBeLessThanOrEqual(midi('C7'));
            }
          }
        }
      }
    }
  });

  it('loops after 45 to 90 seconds (the short ones are only the mini-games and the cutscenes)', () => {
    for (const [id, t] of Object.entries(MUSIC)) {
      const s = loopSeconds(t);
      expect(Math.abs(s - loopBars(t) * barSeconds(t)) < 1e-9, id).toBe(true);
      if (t.short) expect(SHORT, id).toContain(id);
      else {
        expect(s, id).toBeGreaterThanOrEqual(45);
        expect(s, id).toBeLessThanOrEqual(90);
      }
    }
  });

  it('is calm: soft waves for the tune, at most 120 beats a minute, the melody mostly from C4 to C6', () => {
    for (const [id, t] of Object.entries(MUSIC)) {
      if (t.short) continue;
      expect(t.bpm, id).toBeLessThanOrEqual(120);
      const lead = t.voices.find((v) => v.name === 'lead')!;
      expect(['sine', 'triangle'], id).toContain(lead.wave);
      for (const v of t.voices) expect(v.wave, `${id} ${v.name}`).not.toBe('square');
      const notes = lead.bars.flatMap((b) => readBar(b).notes.flatMap((n) => n.midi));
      const inside = notes.filter((m) => m >= midi('C4') && m <= midi('C6')).length;
      expect(inside / notes.length, id).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('every place has its sound', () => {
  it('no two regions share a tune, and each has a night version when it is outdoors', () => {
    const tunes = Object.values(regions).map((r) => r.music);
    expect(new Set(tunes).size).toBe(tunes.length);
    for (const r of Object.values(regions)) expect(MUSIC[r.music], r.id).toBeDefined();
    for (const id of NIGHT_REGIONS) {
      expect(regions[id]!.music).toBe(id);
      expect(MUSIC[`${id}_night`], id).toBeDefined();
    }
  });

  it('every area names a tune that exists, and rooms play by kind', () => {
    for (const a of Object.values(content.areas)) expect(MUSIC[a.music ?? ''], a.id).toBeDefined();
    expect(MUSIC[meet.music]).toBeDefined();
    for (const [room, tune] of Object.entries({ ...ROOM_MUSIC, ...INTERIOR_MUSIC })) {
      expect(MUSIC[tune], room).toBeDefined();
      expect(content.areas[room]?.music, room).toBe(tune);
    }
    const rooms = Object.values(content.areas).filter((a) => a.id !== 'island');
    expect(rooms.filter((a) => a.music === 'home')).toEqual([]);
  });

  it('every tune a cutscene, a quest or the jukebox asks for exists', () => {
    const asked = new Set<string>();
    const dir = resolve(import.meta.dirname, '../src');
    const files = ['data', 'data/quests', 'game/ui/menus', 'game/scenes'].flatMap((d) =>
      readdirSync(resolve(dir, d))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => resolve(dir, d, f)),
    );
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:a: 'music', id|music): '(\w+)'/g)) asked.add(m[1]!);
      for (const m of text.matchAll(/Sound\.music\('(\w+)'\)/g)) asked.add(m[1]!);
      for (const m of text.matchAll(/disc_\w+: '(\w+)'/g)) asked.add(m[1]!);
    }
    expect(asked.size).toBeGreaterThan(10);
    for (const id of asked) expect(MUSIC[id], id).toBeDefined();
  });
});
