// Things on a roof (design section 6, the chest on the school roof): a chest or pick-up placed inside the footprint
// of a building is drawn on top of that building, not hidden behind it, with its normal world picture. The rules
// treat it as a normal chest she opens from the ladder beside it.
import type { AreaDef, Content, MapObj } from '../../core/types.ts';

/** The drawing depth that puts a chest or pick-up on its building's roof, or null when it is not on one. */
export function roofDepth(area: AreaDef, content: Content, object: MapObj): number | null {
  if (!['chest', 'pickup'].includes(content.objects[object.type]?.interact ?? '')) return null;
  const building = area.objects.find((candidate) => {
    const type = content.objects[candidate.type];
    if (!type?.solid || candidate === object || ((type.w ?? 1) < 2 && (type.h ?? 1) < 2)) return false;
    return (
      object.x >= candidate.x &&
      object.x < candidate.x + (type.w ?? 1) &&
      object.y >= candidate.y &&
      object.y < candidate.y + (type.h ?? 1)
    );
  });
  return building ? (building.y + (content.objects[building.type]!.h ?? 1)) * 64 - 4 : null;
}
