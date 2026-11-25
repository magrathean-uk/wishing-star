// The shared place's line to the server (package 66): one WebSocket at api/room, relative to where the game is served
// (it may sit under /christmas/ behind a proxy). The token goes in the first message, never in the address.
// The server decides everything that matters (where a player may be, the balloon, the race, what chat may say);
// this file only sends what the player did and hands on what came back.
import { net } from '../net.ts';

export type Row = [id: string, x: number, y: number, d: string, c: string];
export interface Card {
  id: string;
  label: string;
  hero: string;
  x: number;
  y: number;
  d: string;
  c: string;
}
export interface BallCard {
  x0: number;
  y0: number;
  h0: number;
  vx: number;
  vy: number;
  vh: number;
  n: number;
  age: number;
}
export type In =
  | {
      t: 'welcome';
      you: string;
      x: number;
      y: number;
      chat: boolean;
      players: Card[];
      ball: BallCard | null;
      best: number;
      race: { phase: string; ms: number } | null;
    }
  | ({ t: 'join' } & Card)
  | { t: 'leave'; id: string }
  | { t: 'pos'; p: Row[] }
  | { t: 'fix'; x: number; y: number }
  | { t: 'fun'; id: string; m: string; o: number; ax: number; ay: number; bx: number; by: number; d: string }
  | { t: 'emo'; id: string }
  | { t: 'say'; id: string; text: string }
  | { t: 'ph'; id: string; n: number }
  | { t: 'no' }
  | { t: 'slow' }
  | { t: 'muted' }
  | { t: 'chat'; on: boolean }
  | ({ t: 'ball' } & BallCard)
  | { t: 'hit'; id: string }
  | { t: 'land'; n: number; best: number }
  | { t: 'race'; phase: 'count' | 'go' | 'end'; ms?: number; ids?: string[]; win?: string | null };

/** Why the line ended: the server could not be reached, the login is old, or this player opened it elsewhere. */
export type Ended = 'offline' | 'login' | 'replaced' | 'closed';

export class RoomLink {
  private ws: WebSocket | null = null;
  private last = '';
  private lastAt = 0;
  /** what came in since the scene last looked (handled in its update, never in the middle of a frame) */
  readonly inbox: In[] = [];
  ended: Ended | null = null;
  welcomed = false;

  /** Open the line and say who this is. Resolves true once the server has welcomed the player. */
  open(hero: string): Promise<boolean> {
    return new Promise((done) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done(ok);
      };
      const timer = setTimeout(() => {
        this.ended ??= 'offline';
        this.close();
        finish(false);
      }, 8000);
      let ws: WebSocket;
      try {
        const url = new URL(`${import.meta.env.BASE_URL}api/room`, location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(url);
      } catch {
        this.ended = 'offline';
        finish(false);
        return;
      }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hi', token: net.token, hero }));
      ws.onmessage = (e) => {
        let m: In;
        try {
          m = JSON.parse(String(e.data)) as In;
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.welcomed = true;
          finish(true);
        }
        this.inbox.push(m);
      };
      ws.onclose = (e) => {
        this.ws = null;
        this.ended ??= e.code === 4003 ? 'login' : e.code === 4000 ? 'replaced' : this.welcomed ? 'closed' : 'offline';
        finish(false);
      };
    });
  }

  private send(m: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Where the player is: sent when it changed, at most 10 times a second, and once a second while still. */
  place(x: number, y: number, d: string, c: string, now: number): void {
    const key = `${x.toFixed(2)},${y.toFixed(2)},${d},${c}`;
    if (now - this.lastAt < 100 || (key === this.last && now - this.lastAt < 1000)) return;
    this.last = key;
    this.lastAt = now;
    this.send({ t: 'mv', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, d, c });
  }
  fun(m: string, o: number, ax: number, ay: number, bx: number, by: number, d: string): void {
    const r = (v: number) => Math.round(v * 100) / 100;
    this.send({ t: 'fun', m, o, ax: r(ax), ay: r(ay), bx: r(bx), by: r(by), d });
  }
  emote(): void {
    this.send({ t: 'emo' });
  }
  say(text: string): void {
    this.send({ t: 'say', text });
  }
  phrase(n: number): void {
    this.send({ t: 'ph', n });
  }
  kick(): void {
    this.send({ t: 'kick' });
  }
  race(): void {
    this.send({ t: 'race' });
  }
  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.ended ??= 'closed';
  }
}
