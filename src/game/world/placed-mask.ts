import type { AreaDef, Game } from '../../core/types.ts';

/** A small per-area mask of placed floors and furniture, rebuilt only when the world's revision changes. */
export class PlacedTileMask {
  private areaId = '';
  private revision = -1;
  private width = 0;
  private height = 0;
  private cells = new Uint8Array();

  invalidate(): void {
    this.revision = -1;
    this.areaId = '';
  }

  refresh(game: Game, area: AreaDef): boolean {
    const revision = game.rt.worldRev;
    if (this.areaId === area.id && this.revision === revision && this.width === area.w && this.height === area.h)
      return false;

    const cells = new Uint8Array(area.w * area.h);
    for (const placed of game.s.placed) {
      if (placed.area !== area.id) continue;
      const def = game.c.items[placed.item]?.place;
      if (!def) continue;
      const width = placed.rot && placed.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
      const height = placed.rot && placed.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const x = placed.x + dx;
          const y = placed.y + dy;
          if (x >= 0 && y >= 0 && x < area.w && y < area.h) cells[y * area.w + x] = 1;
        }
      }
    }
    this.areaId = area.id;
    this.revision = revision;
    this.width = area.w;
    this.height = area.h;
    this.cells = cells;
    return true;
  }

  has(area: AreaDef, x: number, y: number): boolean {
    return (
      this.areaId === area.id &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      this.cells[y * this.width + x] !== 0
    );
  }
}
