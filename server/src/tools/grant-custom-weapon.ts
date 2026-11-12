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
import { customWeaponTemplates } from "../game-data/custom-weapon-data.js";
import type { Player, PersistedState } from "../persistence/player-repository.js";

/** Only add missing base copies. Never changes prior instances, progression, currencies, formations, or other accounts. */
export function grantCustomWeapon(
  source: Player,
  id = "astral-covenant",
  minimumCopies = 1,
  grantTime = Math.floor(Date.now() / 1000),
): Player {
  if (!Number.isSafeInteger(minimumCopies) || minimumCopies < 1 || minimumCopies > 40)
    throw new Error("Choose between 1 and 40 copies");
  const definition = customWeaponTemplates().find((item) => item.id === id);
  if (!definition) throw new Error("Unknown custom weapon");
  const result = structuredClone(source);
  const owned = result.inventory.filter(
    (item) =>
      item.count > 0 &&
      [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
        definition.gdpl.join(":"),
  );
  const used = new Set(result.inventory.map((item) => item.guid));
  let next = Math.max(result.nextItemGuid, Math.max(0, ...used) + 1);
  while (owned.length < minimumCopies) {
    while (used.has(next)) next++;
    if (!Number.isSafeInteger(next) || next >= 0xffff_ffff)
      throw new Error("Item GUID space exhausted");
    const [genre, detail, particular, templateLevel] = definition.gdpl;
    const item = {
      guid: next++,
      genre,
      detail,
      particular,
      templateLevel,
      count: 1,
      createTime: grantTime,
      enhanceLevel: 1,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    };
    used.add(item.guid);
    result.inventory.push(item);
    owned.push(item);
  }
  result.nextItemGuid = Math.max(result.nextItemGuid, next);
  return result;
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
      "Specify --account=NAME:password. Preview is default; applying requires a stopped server and --backup=ABSOLUTE_PATH.",
    );
  const statePath = path.resolve(option("state") ?? "data/state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as PersistedState;
  if (state.schemaVersion !== 1 || !state.players[account])
    throw new Error("Account or save schema not found");
  const before = state.players[account];
  const after = grantCustomWeapon(
    before,
    option("weapon") ?? "astral-covenant",
    Number(option("copies") ?? 1),
  );
  const added = after.inventory.filter(
    (item) => !before.inventory.some((old) => old.guid === item.guid),
  );
  const apply = args.includes("--apply");
  if (apply && added.length > 0) {
    const backup = option("backup");
    if (
      !backup ||
      !path.isAbsolute(backup) ||
      path.resolve(backup).toLowerCase() === statePath.toLowerCase()
    )
      throw new Error("Specify a separate absolute backup path");
    if (existsSync("logs/server.pid")) {
      const pid = Number(readFileSync("logs/server.pid", "utf8").trim());
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          throw new Error(
            "Stop the tracked server before applying a grant; it caches the save",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }
    mkdirSync(path.dirname(backup), { recursive: true });
    copyFileSync(statePath, backup, constants.COPYFILE_EXCL);
    state.players[account] = after;
    state.updatedAt = new Date().toISOString();
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporary, statePath);
  }
  console.log(
    JSON.stringify(
      {
        applied: apply,
        roleId: after.roleId,
        weapon: option("weapon") ?? "astral-covenant",
        addedGuids: added.map((item) => item.guid),
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
