// Helpers for laying out a map by script: a terrain grid, objects with keep-out, paths, scatter and named places.
import { hash2 } from '../../src/core/cond.ts';
import { TERRAIN } from '../../src/core/grid.ts';
import type {
  AreaDef,
  Barrier,
  BuildSite,
  Cond,
  Dir,
  Door,
  MapObj,
  ObjectType,
  Place,
  SpawnZone,
} from '../../src/core/types.ts';

export class MapMaker {
  readonly ter: string[][];
  readonly reg: string[][];
  readonly objects: MapObj[] = [];
  readonly barriers: Barrier[] = [];
  readonly zones: SpawnZone[] = [];
  readonly sites: BuildSite[] = [];
  readonly doors: Door[] = [];
  readonly places: Record<string, Place> = {};
  /** 1 where nothing may be scattered (paths, landmarks, doorways) */
  readonly keep: Uint8Array;
  /** 1 where an object already stands */
  readonly taken: Uint8Array;
  private ids: Record<string, number> = {};

  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly types: Record<string, ObjectType>;

  constructor(
    id: string,
    name: string,
    w: number,
    h: number,
    types: Record<string, ObjectType>,
    fill = 'v',
    region = ' ',
  ) {
    this.id = id;
    this.name = name;
    this.w = w;
    this.h = h;
    this.types = types;
    this.ter = Array.from({ length: h }, () => new Array<string>(w).fill(fill));
    this.reg = Array.from({ length: h }, () => new Array<string>(w).fill(region));
    this.keep = new Uint8Array(w * h);
    this.taken = new Uint8Array(w * h);
  }

  in(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): string {
    return this.in(x, y) ? this.ter[y]![x]! : 'v';
  }
  set(x: number, y: number, c: string): void {
    if (this.in(x, y)) this.ter[y]![x] = c;
  }
  region(x: number, y: number): string {
    return this.in(x, y) ? this.reg[y]![x]! : ' ';
  }
  walk(x: number, y: number): boolean {
    return (TERRAIN[this.get(x, y)]?.walk ?? 0) > 0;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  regionRect(x0: number, y0: number, x1: number, y1: number, code: string): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.in(x, y)) this.reg[y]![x] = code;
  }
  /** An ellipse with a wobbly edge. `only` limits which terrain may be replaced. */
  blob(cx: number, cy: number, rx: number, ry: number, c: string, seed = 1, wobble = 0.25, only?: string): void {
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++)
      for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        if (!this.in(x, y)) continue;
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        const n = (noise(x / 3.1, y / 3.1, seed) - 0.5) * 2 * wobble;
        if (d + n <= 1 && (!only || only.includes(this.get(x, y)))) this.set(x, y, c);
      }
  }
  keepRect(x: number, y: number, w: number, h: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if (this.in(x + i, y + j)) this.keep[(y + j) * this.w + x + i] = 1;
  }
  /** A trail through a list of points. Marks itself keep-out so nothing is scattered on it. */
  path(points: [number, number][], width = 2, c = 'p', only = 'gGdsamt'): void {
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i]!;
      const [x1, y1] = points[i + 1]!;
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        const px = x0 + (x1 - x0) * t;
        const py = y0 + (y1 - y0) * t;
        for (let j = 0; j < width; j++)
          for (let k = 0; k < width; k++) {
            const x = Math.floor(px) + k - Math.floor((width - 1) / 2);
            const y = Math.floor(py) + j - Math.floor((width - 1) / 2);
            if (!this.in(x, y)) continue;
            if (only.includes(this.get(x, y))) this.set(x, y, c);
            this.keepRect(x - 1, y - 1, 3, 3);
          }
      }
    }
  }
  private nextId(type: string): string {
    const n = (this.ids[type] = (this.ids[type] ?? 0) + 1);
    return `${this.id[0]}_${type}_${n}`;
  }
  free(type: string, x: number, y: number): boolean {
    const t = this.types[type];
    if (!t) throw new Error(`map: unknown object type ${type}`);
    for (let j = 0; j < (t.h ?? 1); j++)
      for (let i = 0; i < (t.w ?? 1); i++) {
        if (!this.in(x + i, y + j)) return false;
        if (this.taken[(y + j) * this.w + x + i]) return false;
        if (!this.walk(x + i, y + j)) return false;
      }
    return true;
  }
  /** Put an object down. x, y is the top-left tile of its footprint. */
  put(
    type: string,
    x: number,
    y: number,
    opts: { id?: string; if?: Cond; d?: string; force?: boolean; margin?: number } = {},
  ): MapObj {
    const t = this.types[type];
    if (!t) throw new Error(`map: unknown object type ${type}`);
    const o: MapObj = { id: opts.id ?? this.nextId(type), type, x, y };
    if (opts.if) o.if = opts.if;
    if (opts.d) o.d = opts.d;
    if (this.objects.some((q) => q.id === o.id)) throw new Error(`map: duplicate object id ${o.id}`);
    this.objects.push(o);
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if (this.in(x + i, y + j)) this.taken[(y + j) * this.w + x + i] = 1;
    const m = opts.margin ?? (t.solid && (w > 1 || h > 1) ? 1 : 0);
    this.keepRect(x - m, y - m, w + m * 2, h + m * 2);
    return o;
  }
  place(name: string, x: number, y: number, label?: string, r?: number): void {
    if (this.places[name]) throw new Error(`map: duplicate place ${name}`);
    const p: Place = { area: this.id, x, y };
    if (label) p.label = label;
    if (r) p.r = r;
    this.places[name] = p;
    this.keepRect(x - 1, y - 1, 3, 3);
  }
  door(x: number, y: number, to: string, tx: number, ty: number, dir: Dir, extra: Partial<Door> = {}): void {
    this.doors.push({ x, y, to, tx, ty, dir, ...extra });
    this.keepRect(x - 1, y - 1, 3, 3);
  }
  /** Sprinkle objects where a rule allows. `density` is the chance per tile. */
  scatter(
    type: string,
    density: number,
    seed: number,
    ok: (x: number, y: number) => boolean,
    x0 = 0,
    y0 = 0,
    x1 = this.w - 1,
    y1 = this.h - 1,
  ): number {
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (this.keep[y * this.w + x] || this.taken[y * this.w + x]) continue;
        if (hash2(x, y, seed) >= density) continue;
        if (!ok(x, y) || !this.free(type, x, y)) continue;
        this.put(type, x, y, { margin: 0 });
        n++;
      }
    return n;
  }
  /** Check that every named place, door and build site can be stood on. */
  check(): string[] {
    const bad: string[] = [];
    for (const name in this.places) {
      const p = this.places[name]!;
      if (!this.walk(p.x, p.y)) bad.push(`place ${name} at ${p.x},${p.y} is on ${this.get(p.x, p.y)}`);
      const o = this.objects.find((q) => {
        const t = this.types[q.type]!;
        return t.solid && !q.if && p.x >= q.x && p.y >= q.y && p.x < q.x + (t.w ?? 1) && p.y < q.y + (t.h ?? 1);
      });
      if (o) bad.push(`place ${name} at ${p.x},${p.y} is inside ${o.id}`);
    }
    for (const s of this.sites) if (!this.walk(s.at.x, s.at.y)) bad.push(`site ${s.id} hand-over point is blocked`);
    return bad;
  }
  toArea(extra: Partial<AreaDef> = {}): AreaDef {
    return {
      id: this.id,
      name: this.name,
      w: this.w,
      h: this.h,
      terrain: this.ter.map((r) => r.join('')),
      region: this.reg.map((r) => r.join('')),
      objects: this.objects,
      barriers: this.barriers,
      zones: this.zones,
      sites: this.sites,
      doors: this.doors,
      places: this.places,
      ...extra,
    };
  }
  /** Build from rows of characters: terrain codes, plus a legend of extra characters that drop objects or places on floor. */
  static fromRows(
    id: string,
    name: string,
    rows: string[],
    types: Record<string, ObjectType>,
    legend: Record<string, (m: MapMaker, x: number, y: number) => void>,
    floor = 'f',
    region = 'I',
  ): MapMaker {
    const w = Math.max(...rows.map((r) => r.length));
    const m = new MapMaker(id, name, w, rows.length, types, 'v', region);
    const later: (() => void)[] = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) {
        const ch = row.charAt(x) || ' ';
        if (ch === ' ') m.set(x, y, 'v');
        else if (TERRAIN[ch] && !legend[ch]) m.set(x, y, ch);
        else if (legend[ch]) {
          m.set(x, y, floor);
          later.push(() => legend[ch]!(m, x, y));
        } else throw new Error(`map ${id}: unknown character "${ch}" at ${x},${y}`);
      }
    });
    for (const f of later) f();
    return m;
  }
}

/** Smooth value noise in [0, 1). */
export function noise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
