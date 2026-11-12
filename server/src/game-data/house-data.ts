import type { CafeFurnitureState } from "../persistence/player-repository.js";
import { decodeFields, readVarint, type DecodedField } from "../protocol/protobuf.js";

/** Shipped gameproto house messages, confirmed against ARM64 Serialize methods. */
export interface HousePoseState {
  templateId: number;
  parentTemplateId: number;
  place: number;
  posX: number;
  posY: number;
  rotate: number;
}
export interface HouseRoomState {
  roomId: number;
  girlIds: number[];
  friendGirlId: number;
  themeId: number;
  furnitureIds: number[];
}
export interface HouseThemeState {
  themeId: number;
  templateThemeId: number;
  name: string;
  poses: HousePoseState[];
  newGenerate: boolean;
  roomtype: number;
  createtime: number;
}
export interface HouseFurnitureChange {
  templateId: number;
  objId: number;
  parentId?: number;
  roomId?: number;
  pose?: Partial<HousePoseState>;
  status?: number;
  isNew?: boolean;
  bizcount?: number;
}
export interface HouseRoomChange {
  roomId: number;
  girlIds?: number[];
  friendGirlId?: number;
  themeId?: number;
  /** ReqSaveArea sends only changed members; derive full membership after merge. */
  furnitureIds?: number[];
}
export interface HouseThemeChange {
  themeId?: number;
  templateThemeId?: number;
  name?: string;
  poses?: HousePoseState[];
  newGenerate?: boolean;
  roomtype?: number;
  createtime?: number;
}
export interface HouseChanges {
  roleId: number;
  rooms: HouseRoomChange[];
  furniture: HouseFurnitureChange[];
  themes: HouseThemeChange[];
}
export interface HouseData {
  rooms: HouseRoomState[];
  furniture: CafeFurnitureState[];
  themes: HouseThemeState[];
}

/** Native CafePb embedded by OtherHouseInfoRsp, using the same names as Lua café data. */
export interface HouseGuestState {
  position?: number;
  coffeetype?: number;
  customeridx: number;
  customertype: number;
  starttime: number;
}
export interface HouseCafeSnapshot {
  level: number;
  comfort: number;
  hot: number;
  basetime: number;
  nextidx?: number;
  touchtime?: number;
  roomgirlslist?: readonly (readonly { girlId: number; modelId: number }[])[];
  coffeelist?: readonly { coffeetype: number; count: number }[];
  seatlist?: readonly HouseGuestState[];
  customerqueue?: readonly HouseGuestState[];
  fixedtime?: number;
}
export interface HouseMusicState {
  id: number;
  nG: number;
  nD: number;
  nP: number;
  nL: number;
}
export interface HouseVisitedState {
  entrustLog: { roleName: string; endTime: number }[];
  entrustNum: number;
  entrustTime: number;
  visitedList: {
    roleId: number;
    name: string;
    time: number;
    girlId: number;
    modelId: number;
    comfortScore: number;
  }[];
  taskList: { roleId: number; startTime: number; missionId: number }[];
}

// These client-created scene identities are not owned furniture GUIDs. A save
// may legitimately include them (floors/walls/defaults); never reallocate them.
export const NATIVE_FIXED_HOUSE_OBJECT_IDS = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22, 23, 30, 31, 32,
  33, 34, 35, 50, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68,
  69, 72, 73, 80, 81, 82, 83, 84, 85,
]);
const FIXED_IDS = new Set<number>(NATIVE_FIXED_HOUSE_OBJECT_IDS);
export function isNativeFixedHouseObjectId(id: number): boolean {
  return FIXED_IDS.has(id);
}

const UINT32_MAX = 0xffff_ffffn;
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PAYLOAD = 2 * 1024 * 1024;
const MAX_REPEATED = 4_096;

function fields(payload: Buffer): DecodedField[] {
  if (payload.length > MAX_PAYLOAD) throw new Error("House request is too large");
  return decodeFields(payload);
}
function singular(
  all: readonly DecodedField[],
  tag: number,
  wire: number,
): DecodedField | undefined {
  const matches = all.filter((f) => f.fieldNumber === tag);
  if (matches.length > 1 || matches.some((f) => f.wireType !== wire))
    throw new Error(`Invalid house field ${tag}`);
  return matches[0];
}
function uint(
  all: readonly DecodedField[],
  tag: number,
  max = UINT32_MAX,
): number | undefined {
  const field = singular(all, tag, 0);
  if (!field) return undefined;
  if (typeof field.value !== "bigint" || field.value < 0n || field.value > max)
    throw new Error(`House integer ${tag} is out of range`);
  return Number(field.value);
}
function requiredId(all: readonly DecodedField[], tag: number): number {
  const value = uint(all, tag);
  if (value === undefined || value === 0)
    throw new Error(`Missing house identity ${tag}`);
  return value;
}
function bool(all: readonly DecodedField[], tag: number): boolean | undefined {
  const value = uint(all, tag, 1n);
  return value === undefined ? undefined : value !== 0;
}
function bytes(all: readonly DecodedField[], tag: number): Buffer | undefined {
  const field = singular(all, tag, 2);
  if (!field) return undefined;
  if (!Buffer.isBuffer(field.value)) throw new Error(`Invalid house message ${tag}`);
  return field.value;
}
function text(all: readonly DecodedField[], tag: number): string | undefined {
  const data = bytes(all, tag);
  if (data === undefined) return undefined;
  if (data.length > 4_096) throw new Error("House theme name is too large");
  // Buffer's replacement decoder would silently change malformed saved names.
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
function messages<T>(
  all: readonly DecodedField[],
  tag: number,
  read: (payload: Buffer) => T,
): T[] {
  const selected = all.filter((f) => f.fieldNumber === tag);
  if (selected.length > MAX_REPEATED) throw new Error("Too many house entries");
  return selected.map((f) => {
    if (f.wireType !== 2 || !Buffer.isBuffer(f.value))
      throw new Error(`Invalid repeated house message ${tag}`);
    return read(f.value);
  });
}
function uints(all: readonly DecodedField[], tag: number): number[] | undefined {
  const selected = all.filter((f) => f.fieldNumber === tag);
  if (selected.length === 0) return undefined;
  const result: number[] = [];
  const append = (value: bigint) => {
    if (value < 0n || value > UINT32_MAX)
      throw new Error("House list integer is out of range");
    result.push(Number(value));
    if (result.length > MAX_REPEATED) throw new Error("Too many house list entries");
  };
  for (const field of selected) {
    if (field.wireType === 0 && typeof field.value === "bigint") append(field.value);
    else if (field.wireType === 2 && Buffer.isBuffer(field.value)) {
      for (let offset = 0; offset < field.value.length;) {
        const next = readVarint(field.value, offset);
        append(next.value);
        offset = next.offset;
      }
    } else throw new Error(`Invalid repeated house integer ${tag}`);
  }
  return result;
}
function set<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
function unique<T>(items: readonly T[], identity: (item: T) => number): void {
  const ids = items.map(identity);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate house identity");
}
function poseChange(payload: Buffer): Partial<HousePoseState> {
  const all = fields(payload);
  const result: Partial<HousePoseState> = {};
  set(result, "templateId", uint(all, 1));
  set(result, "parentTemplateId", uint(all, 2));
  set(result, "place", uint(all, 3));
  set(result, "posX", uint(all, 4));
  set(result, "posY", uint(all, 5));
  set(result, "rotate", uint(all, 6));
  return result;
}
function themePose(payload: Buffer): HousePoseState {
  return {
    templateId: 0,
    parentTemplateId: 0,
    place: 0,
    posX: 0,
    posY: 0,
    rotate: 0,
    ...poseChange(payload),
  };
}
function furnitureChange(payload: Buffer): HouseFurnitureChange {
  const all = fields(payload);
  const result: HouseFurnitureChange = {
    templateId: requiredId(all, 1),
    objId: requiredId(all, 2),
  };
  set(result, "parentId", uint(all, 3));
  set(result, "roomId", uint(all, 4));
  const pose = bytes(all, 5);
  if (pose !== undefined) result.pose = poseChange(pose);
  set(result, "status", uint(all, 6));
  set(result, "isNew", bool(all, 7));
  set(result, "bizcount", uint(all, 8));
  return result;
}
function roomChange(payload: Buffer): HouseRoomChange {
  const all = fields(payload);
  const result: HouseRoomChange = { roomId: requiredId(all, 1) };
  set(result, "girlIds", uints(all, 2));
  set(result, "friendGirlId", uint(all, 3));
  set(result, "themeId", uint(all, 4));
  set(result, "furnitureIds", uints(all, 5));
  return result;
}
function themeChange(payload: Buffer): HouseThemeChange {
  const all = fields(payload);
  const result: HouseThemeChange = {};
  set(result, "themeId", uint(all, 1));
  set(result, "templateThemeId", uint(all, 2));
  set(result, "name", text(all, 3));
  if (all.some((f) => f.fieldNumber === 4)) result.poses = messages(all, 4, themePose);
  set(result, "newGenerate", bool(all, 5));
  set(result, "roomtype", uint(all, 6));
  set(result, "createtime", uint(all, 7, SAFE_MAX));
  return result;
}

/** Empty/zero role ID means the authenticated player's own house. */
export function parseHouseInfoRequest(payload: Buffer): { roleId: number } {
  return { roleId: uint(fields(payload), 1, SAFE_MAX) ?? 0 };
}
/** NCafeDataController.ReqSaveArea sends deltas, not a complete inventory. */
export function parseUpdateHouseRequest(payload: Buffer): HouseChanges {
  const all = fields(payload);
  const result: HouseChanges = {
    roleId: uint(all, 1, SAFE_MAX) ?? 0,
    rooms: messages(all, 2, roomChange),
    furniture: messages(all, 3, furnitureChange),
    themes: messages(all, 4, themeChange),
  };
  unique(result.rooms, (room) => room.roomId);
  unique(result.furniture, (item) => item.objId);
  unique(
    result.themes.filter((theme) => (theme.themeId ?? 0) > 0),
    (theme) => theme.themeId!,
  );
  return result;
}
export function parseAddFurnitureRequest(payload: Buffer): {
  roleId: number;
  templateIds: number[];
} {
  const all = fields(payload);
  return { roleId: uint(all, 1, SAFE_MAX) ?? 0, templateIds: uints(all, 2) ?? [] };
}
export function parseAddHouseThemeRequest(payload: Buffer): {
  roleId: number;
  theme: HouseThemeChange;
  templateIds: number[];
} {
  const all = fields(payload);
  const theme = bytes(all, 2);
  if (theme === undefined) throw new Error("Missing house theme");
  return {
    roleId: uint(all, 1, SAFE_MAX) ?? 0,
    theme: themeChange(theme),
    templateIds: uints(all, 3) ?? [],
  };
}
export function parseDeleteHouseThemeRequest(payload: Buffer): {
  roleId: number;
  themeId: number;
} {
  const all = fields(payload);
  return { roleId: uint(all, 1, SAFE_MAX) ?? 0, themeId: requiredId(all, 2) };
}

/** CMD_HOUSE_OHTER_REQ is misspelled in the shipped enum, but its payload is normal. */
export function parseOtherHouseInfoRequest(payload: Buffer): { roleId: number } {
  const all = fields(payload);
  const roleId = uint(all, 1, SAFE_MAX);
  if (roleId === undefined || roleId === 0)
    throw new Error("Missing visited house role ID");
  return { roleId };
}
