// Plays the music player through a real Web Audio engine, offline and silent (D86): a headless browser renders 14
// seconds into an OfflineAudioContext while the player cross-fades home -> bay, walks a border back and forth, and
// fades to silence. Fails on any audio error, on clipping, or on a tune left playing.
//   node tools/music/browser-check.ts --url http://127.0.0.1:<dev server port>/   (a Vite dev server of this repo)
import { chromium } from 'playwright';

const url = process.argv[process.argv.indexOf('--url') + 1] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${url}?test=music`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  document.title = `TEST ${document.title}`;
});
for (const engine of ['chromium'] as const) {
  const r = await page.evaluate(async () => {
    const { MusicPlayer, FADE_PLACE, DWELL } = await import('/src/game/musicplayer.ts' as string);
    const RATE = 24000;
    const LEN = 14;
    const ctx = new OfflineAudioContext(1, RATE * LEN, RATE);
    const p = new MusicPlayer(ctx, ctx.destination);
    const log: string[] = [];
    let peakLive = 0;
    p.want('home', FADE_PLACE);
    for (let k = 1; k < LEN * 20; k++) {
      const t = k / 20;
      void ctx.suspend(t).then(() => {
        try {
          if (k === 80) p.want('bay', FADE_PLACE, DWELL); // 4.0 s: over the border
          if (k === 90) p.want('bay', FADE_PLACE, DWELL); // still there at 4.5 s
          if (k === 100) p.want('bay', FADE_PLACE, DWELL); // 5.0 s: one second there, the change is taken
          if (k === 160) p.want('home', FADE_PLACE, DWELL); // 8.0 s: back over the border...
          if (k === 168) p.want('bay', FADE_PLACE, DWELL); // ...and back within half a second: nothing changes
          if (k === 220) p.want('', 0.7); // 11 s: silence
          p.tick();
          peakLive = Math.max(peakLive, p.live());
          if (k === 150 || k === 200 || k === LEN * 20 - 1)
            log.push(`${t}s:${p.decks.map((d: { id: string }) => d.id).join('+')}`);
        } catch (e) {
          log.push(`ERROR ${e}`);
        }
        void ctx.resume();
      });
    }
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    const sec = (a: number, b: number) => {
      let sq = 0;
      let pk = 0;
      for (let i = a * RATE; i < b * RATE; i++) {
        sq += d[i]! * d[i]!;
        pk = Math.max(pk, Math.abs(d[i]!));
      }
      return { rms: Math.sqrt(sq / ((b - a) * RATE)), pk };
    };
    return { log, peakLive, home: sec(1, 4), fade: sec(5, 7), bay: sec(7, 11), quiet: sec(12.5, 14), all: sec(0, LEN) };
  });
  console.log(engine, JSON.stringify(r));
  const ok =
    !errors.length &&
    !r.log.some((l: string) => l.startsWith('ERROR')) &&
    r.log.join(' ') === '7.5s:bay 10s:bay 13.95s:' &&
    r.home.rms > 0.01 &&
    r.bay.rms > 0.01 &&
    r.fade.rms > 0.01 &&
    r.quiet.pk < 0.001 &&
    r.all.pk < 0.9;
  console.log(ok ? 'MUSIC BROWSER OK' : `MUSIC BROWSER BAD ${errors.join(' ')}`);
  process.exitCode = ok ? 0 : 1;
}
await browser.close();
