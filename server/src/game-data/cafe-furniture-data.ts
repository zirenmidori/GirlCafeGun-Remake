import type { CafeFurnitureState } from "../persistence/player-repository.js";

// Native NCafeDataController creates fixed/default scene objects with GUIDs
// matching their template IDs (54 IDs, maximum 85 in the recovered client).
// User furniture shares that dictionary, so allocate it in a separate range.
export const FIRST_CAFE_FURNITURE_OBJECT_ID = 10_000;
const MAX_OBJECT_ID = 0xffff_ffff;

export function nextCafeFurnitureObjectId(
  items: readonly CafeFurnitureState[],
): number {
  let next = FIRST_CAFE_FURNITURE_OBJECT_ID;
  const seen = new Set<number>();
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.objId) ||
      item.objId < 1 ||
      item.objId > MAX_OBJECT_ID ||
      seen.has(item.objId)
    )
      throw new Error("Invalid or duplicate cafe furniture object ID");
    seen.add(item.objId);
    next = Math.max(next, item.objId + 1);
  }
  if (next > MAX_OBJECT_ID) throw new Error("Cafe furniture object ID space exhausted");
  return next;
}

/** Repair the old test grant's unplaced instances without changing ownership/layout. */
export function repairStoredCafeFurnitureIds(items: readonly CafeFurnitureState[]): {
  furniture: CafeFurnitureState[];
  changed: number;
} {
  let next = nextCafeFurnitureObjectId(items);
  const unsafe = new Set(
    items
      .filter((item) => item.objId < FIRST_CAFE_FURNITURE_OBJECT_ID)
      .map((item) => item.objId),
  );
  for (const item of items) {
    if (
      unsafe.has(item.objId) &&
      (item.roomId !== 0 || item.parentId !== 0 || item.pose.parentTemplateId !== 0)
    )
      throw new Error(
        "Unsafe cafe IDs belong to placed or parented items; automatic storage-only repair refused",
      );
    if (item.parentId !== 0 && unsafe.has(item.parentId))
      throw new Error(
        "Unsafe cafe IDs have layout references; automatic storage-only repair refused",
      );
  }
  const furniture = structuredClone([...items]);
  for (const item of furniture) {
    if (!unsafe.has(item.objId)) continue;
    if (next > MAX_OBJECT_ID)
      throw new Error("Cafe furniture object ID space exhausted");
    item.objId = next++;
  }
  return { furniture, changed: unsafe.size };
}
