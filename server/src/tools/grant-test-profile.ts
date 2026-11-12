import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chapterStarClaimedMask,
  chapterStarTaskValue,
  chapterTotalStars,
  makeChapterStarTaskId,
} from "../game-data/chapter-star-award-data.js";
import {
  defaultGirlFetterCatalog,
  GIRL_FETTER_EVENT_OFFSET,
} from "../game-data/girl-fetter-data.js";
import {
  nextCafeFurnitureObjectId,
  repairStoredCafeFurnitureIds,
} from "../game-data/cafe-furniture-data.js";
import { customWeaponTemplates } from "../game-data/custom-weapon-data.js";
import { isPlayableGirlId } from "../game-data/character-card-data.js";
import { isLinkGirl } from "../game-data/girl-gift-data.js";
import type {
  InventoryEntryState,
  PersistedState,
  Player,
} from "../persistence/player-repository.js";

type Gdpl = [number, number, number, number];
export interface TestProfileCatalog {
  schemaVersion: number;
  playerMaxLevel: number;
  girlAffectionCaps?: Record<string, number>;
  girlMainStoryCounts?: Record<string, number>;
  instanceTemplates: {
    gdpl: Gdpl;
    kind: string;
    girlId?: number;
    modelId?: number;
    maxLevel: number;
    maxBreakLevel: number;
    serverImplementedEnhanceLevel?: number;
  }[];
  stackableTemplates: { gdpl: Gdpl }[];
  currencies: { id: number; maxValue: number }[];
  furnitureLinks: { furnitureId: number }[];
  suitOwnership: { taskKey: number; value: number }[];
  cosmeticOwnership: { taskKey: number; valueMode: string }[];
  backgroundOwnership: { taskKey: number; value: number }[];
  themeOwnership: {
    ownershipTaskKey: number;
    ownershipValue: number;
    availabilityTaskKey: number;
  }[];
  cardStoryUnlocks: { taskKey: number; value: number }[];
  guides: { taskId: number; completedValue: number }[];
}

export function loadTestProfileCatalog(
  file = "resources/test-profile-catalog.json",
): TestProfileCatalog {
  const catalog = JSON.parse(readFileSync(file, "utf8")) as TestProfileCatalog;
  const legacy =
    catalog.schemaVersion === 1 &&
    catalog.instanceTemplates.length === 486 &&
    catalog.stackableTemplates.length === 401 &&
    catalog.furnitureLinks.length === 705 &&
    catalog.cardStoryUnlocks.length === 214;
  const recovered =
    catalog.schemaVersion === 2 &&
    catalog.instanceTemplates.length === 498 &&
    catalog.cardStoryUnlocks.length === 228 &&
    Object.keys(catalog.girlAffectionCaps ?? {}).length === 20 &&
    Object.keys(catalog.girlMainStoryCounts ?? {}).length === 16;
  if (!legacy && !recovered)
    throw new Error("Unrecognized test catalog; no save changes were made.");
  // Keep the recovered source catalog intact; custom extensions apply only to
  // this installation's default catalog, never an explicitly selected old snapshot.
  if (path.resolve(file) === path.resolve("resources/test-profile-catalog.json")) {
    for (const extension of customWeaponTemplates()) {
      if (
        catalog.instanceTemplates.some(
          (item) => item.gdpl.join(":") === extension.gdpl.join(":"),
        )
      )
        throw new Error("Custom weapon overrides a recovered template");
      catalog.instanceTemplates.push({ ...extension, gdpl: [...extension.gdpl] });
    }
  }
  return catalog;
}

/** Client task namespaces isolate collaboration girls from normal girl offsets. */
export function testGirlTaskId(
  group: 3 | 4 | 7,
  girlId: number,
  offset: number,
): number {
  const link = isLinkGirl(girlId);
  const taskGroup = link ? ({ 3: 90, 4: 91, 7: 92 } as const)[group] : group;
  const localGirlId = link ? girlId - 200 : girlId;
  return (taskGroup << 16) | ((localGirlId - 1) * 2000 + offset);
}

/** One-time development grant. Never called by the login or gameplay paths. */
export function grantTestProfile(
  source: Player,
  catalog: TestProfileCatalog,
  chapterText: string,
  grantTime = Math.floor(Date.now() / 1000),
): Player {
  const player = structuredClone(source);
  const task = (id: number, minimum: number) => {
    player.taskValues[String(id)] = Math.max(
      player.taskValues[String(id)] ?? 0,
      minimum,
    );
  };
  const timestamp = (id: number, refresh = false) => {
    if (refresh || !(player.taskValues[String(id)]! > 0))
      player.taskValues[String(id)] = grantTime;
  };
  player.level = catalog.playerMaxLevel;
  player.exp = 0;
  player.live2dEnableLevel = 3;
  task(65551, 6);
  for (const guide of catalog.guides) task(guide.taskId, guide.completedValue);

  const usedGuids = new Set(player.inventory.map((item) => item.guid));
  let nextGuid = Math.max(player.nextItemGuid, Math.max(0, ...usedGuids) + 1);
  const create = (gdpl: Gdpl): InventoryEntryState => {
    while (usedGuids.has(nextGuid)) nextGuid++;
    if (nextGuid >= 0xffff_ffff) throw new Error("Item GUID space exhausted");
    const item = {
      guid: nextGuid++,
      genre: gdpl[0],
      detail: gdpl[1],
      particular: gdpl[2],
      templateLevel: gdpl[3],
      count: 1,
      createTime: grantTime,
      enhanceLevel: 0,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    };
    usedGuids.add(item.guid);
    player.inventory.push(item);
    return item;
  };
  const matches = (item: InventoryEntryState, gdpl: Gdpl) =>
    item.genre === gdpl[0] &&
    item.detail === gdpl[1] &&
    item.particular === gdpl[2] &&
    item.templateLevel === gdpl[3];
  for (const template of catalog.instanceTemplates) {
    const copies = player.inventory.filter((item) => matches(item, template.gdpl));
    while (copies.length < 2) copies.push(create(template.gdpl));
    const upgraded = copies[0]!;
    upgraded.enhanceLevel =
      template.kind === "rune"
        ? (template.serverImplementedEnhanceLevel ?? 1)
        : template.maxLevel;
    upgraded.enhanceExp = 0;
    upgraded.breakLevel = template.kind === "rune" ? 0 : template.maxBreakLevel;
    upgraded.lockOn = 1;
    if (
      !copies.slice(1).some((item) => item.enhanceLevel <= 1 && item.breakLevel === 0)
    )
      copies.push(create(template.gdpl));
    for (const item of copies) {
      item.count = 1;
      if (item.enhanceLevel < 1) item.enhanceLevel = 1;
    }
    if (template.kind === "character") {
      const girlId = template.girlId!;
      const key = testGirlTaskId(7, girlId, template.gdpl[2] * 20 + template.gdpl[3]);
      player.taskValues[String(key)] = copies.length;
      if (!player.girls.some((girl) => girl.girlId === girlId))
        player.girls.push({
          girlId,
          level: 1,
          exp: 0,
          modelId: template.modelId!,
          moodValue: 100,
          vigor: 100,
          flag: 0,
        });
    }
  }
  for (const template of catalog.stackableTemplates) {
    const stack =
      player.inventory.find((item) => matches(item, template.gdpl)) ??
      create(template.gdpl);
    stack.count = Math.max(stack.count, 9999);
  }
  player.nextItemGuid = Math.max(player.nextItemGuid, nextGuid);
  for (const currency of catalog.currencies) {
    let money = player.money.find((m) => m.id === currency.id);
    if (!money) {
      money = { id: currency.id, count: 0 };
      player.money.push(money);
    }
    money.count = Math.min(currency.maxValue, Math.max(money.count, 100_000_000));
  }
  for (const story of catalog.cardStoryUnlocks) task(story.taskKey, story.value);
  for (const suit of catalog.suitOwnership) task(suit.taskKey, suit.value);
  for (const cosmetic of catalog.cosmeticOwnership) timestamp(cosmetic.taskKey, true);
  for (const background of catalog.backgroundOwnership)
    task(background.taskKey, background.value);
  for (const theme of catalog.themeOwnership) {
    timestamp(theme.availabilityTaskKey);
    task(theme.ownershipTaskKey, theme.ownershipValue);
  }

  const levels = new Map(player.levels.map((level) => [level.id, level]));
  const lines = chapterText.split(/\r?\n/);
  const headers = lines[2]!.split("\t");
  for (const line of lines.slice(3)) {
    const columns = line.split("\t");
    const row = Object.fromEntries(
      headers.map((header, index) => [header, columns[index] ?? ""]),
    );
    const chapter = Number(row.Chapter),
      index = Number(row.Index),
      difficulty = Number(row.Difficult);
    if (!(chapter > 0 && index > 0 && difficulty > 0)) continue;
    const id = (chapter << 16) | (index << 8) | difficulty;
    const previous = levels.get(id)?.star ?? 0;
    levels.set(id, {
      id,
      star: Math.max(previous & ~7, 8) | (row.StarType === "1" ? 7 : previous & 7),
    });
  }
  player.levels = [...levels.values()];
  for (let chapter = 1; chapter <= 16; chapter++)
    for (const difficulty of [1, 2]) {
      const stars = chapterTotalStars(player.levels, chapter, difficulty);
      if (stars > 0)
        player.taskValues[String(makeChapterStarTaskId(chapter, difficulty))] =
          chapterStarTaskValue(
            stars,
            chapterStarClaimedMask(
              player.taskValues[String(makeChapterStarTaskId(chapter, difficulty))] ??
                0,
            ),
          );
    }
  for (let subId = 101; subId <= 112; subId++) task((9 << 16) | subId, 6);
  const fetters = defaultGirlFetterCatalog();
  for (const girl of player.girls) {
    if (!isPlayableGirlId(girl.girlId)) continue;
    const link = isLinkGirl(girl.girlId);
    girl.level =
      catalog.girlAffectionCaps?.[String(girl.girlId)] ??
      (link ? 50 : [13, 16].includes(girl.girlId) ? 80 : 100);
    girl.exp = 0;
    girl.moodValue = 100;
    girl.vigor = 100;
    const girlTask = (offset: number) => testGirlTaskId(3, girl.girlId, offset);
    // GirlConfig main-story ordinal, separate from Fetter node indices.
    // Link offset14 is a read bitmask, not a story ordinal; leave it intact.
    if (!link)
      task(
        girlTask(14),
        catalog.girlMainStoryCounts?.[String(girl.girlId)] ??
          ([13, 16].includes(girl.girlId) ? 9 : 12),
      );
    for (
      let secretId = 1;
      secretId <= (link ? 7 : girl.level === 80 ? 18 : 20);
      secretId++
    )
      task(girlTask(100 + secretId - 1), 1);
    for (const node of fetters.nodes(girl.girlId)) {
      if (node.unavailable || girl.level < node.requiredLevel) continue;
      if (
        node.cond &&
        !levels.get(
          (node.cond.chapter << 16) | (node.cond.index << 8) | node.cond.difficulty,
        )?.star
      )
        continue;
      task(girlTask(GIRL_FETTER_EVENT_OFFSET + node.index - 1), 1);
    }
  }
  player.cafe.level = 30;
  task(65568, 30);
  const { furniture } = repairStoredCafeFurnitureIds(player.cafe.furniture ?? []);
  player.cafe.furniture = furniture;
  let objectId = nextCafeFurnitureObjectId(furniture);
  for (const template of catalog.furnitureLinks) {
    if (furniture.some((item) => item.templateId === template.furnitureId)) continue;
    furniture.push({
      templateId: template.furnitureId,
      objId: objectId++,
      parentId: 0,
      roomId: 0,
      pose: {
        templateId: template.furnitureId,
        parentTemplateId: 0,
        place: 0,
        posX: 0,
        posY: 0,
        rotate: 0,
      },
      status: 0,
      isNew: false,
      bizcount: 0,
    });
  }
  return player;
}

export function testProfileSummary(player: Player) {
  return {
    account: player.account,
    roleId: player.roleId,
    level: player.level,
    inventoryEntries: player.inventory.length,
    cards: player.inventory.filter((i) => i.genre === 1).length,
    weapons: player.inventory.filter((i) => i.genre === 2).length,
    runes: player.inventory.filter((i) => i.genre === 3).length,
    currencies: player.money.length,
    girls: player.girls.length,
    clearedStages: player.levels.length,
    furniture: player.cafe.furniture?.length ?? 0,
    cafeLevel: player.cafe.level,
    taskFlags: Object.keys(player.taskValues).length,
  };
}

function main() {
  if (
    process.env.GCG_ENABLE_DEV_TOOLS !== "1" ||
    process.env.GCG_RELEASE_PROFILE === "1"
  )
    throw new Error(
      "Development grants require GCG_ENABLE_DEV_TOOLS=1 and are disabled in the release profile.",
    );
  const args = process.argv.slice(2);
  const option = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const account = option("account");
  if (!account)
    throw new Error(
      "Specify --account=NAME:password (preview by default); --apply additionally requires --backup=ABSOLUTE_PATH. Stop the server before applying.",
    );
  const statePath = path.resolve(option("state") ?? "data/state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as PersistedState;
  if (state.schemaVersion !== 1 || !state.players[account])
    throw new Error("Account or save schema not found");
  const repairOnly = args.includes("--repair-cafe-ids");
  const player = repairOnly
    ? structuredClone(state.players[account])
    : grantTestProfile(
        state.players[account],
        loadTestProfileCatalog(option("catalog")),
        readFileSync("resources/map/chapter.txt", "utf8"),
      );
  let repairedCafeIds = 0;
  if (repairOnly) {
    const result = repairStoredCafeFurnitureIds(player.cafe.furniture ?? []);
    player.cafe.furniture = result.furniture;
    repairedCafeIds = result.changed;
  }
  if (args.includes("--apply")) {
    const backup = option("backup");
    if (!backup || !path.isAbsolute(backup) || path.resolve(backup) === statePath)
      throw new Error("Specify a separate absolute --backup=PATH");
    if (existsSync("logs/server.pid")) {
      const pid = Number(readFileSync("logs/server.pid", "utf8").trim());
      if (Number.isSafeInteger(pid) && pid > 0) {
        let running = false;
        try {
          process.kill(pid, 0);
          running = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        if (running)
          throw new Error(
            "Tracked server is running. Stop it before applying a grant; it caches the save.",
          );
      }
    }
    mkdirSync(path.dirname(backup), { recursive: true });
    copyFileSync(statePath, backup, constants.COPYFILE_EXCL);
    state.players[account] = player;
    state.updatedAt = new Date().toISOString();
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporary, statePath);
    console.log(`Backed up save to ${backup}`);
  }
  console.log(
    JSON.stringify(
      {
        applied: args.includes("--apply"),
        mode: repairOnly ? "repair-cafe-ids" : "full-test-grant",
        repairedCafeIds,
        ...testProfileSummary(player),
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
