import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger.js";
import {
  JsonStore,
  rankBackups,
  SaveFileError,
} from "../src/persistence/json-store.js";
import {
  assertLoadableState,
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import { mkdtemp } from "./helpers/temp.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 14, 6, 30, 5);

const directories: string[] = [];

async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-backup-"));
  directories.push(directory);
  return {
    filePath: path.join(directory, "state.json"),
    backupDirectory: path.join(directory, "backups"),
  };
}

function openStore(filePath: string, backupDirectory: string, keep = 3) {
  return new JsonStore({
    filePath,
    initialState: makeInitialState(),
    logger,
    backups: { directory: backupDirectory, keep },
    validate: assertLoadableState,
  });
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("save backups", () => {
  it("copies the loaded save once per day and keeps the newest copies", async () => {
    const { filePath, backupDirectory } = await workspace();

    // A fresh save has nothing worth copying yet.
    await openStore(filePath, backupDirectory).initialize(START);
    await expect(readdir(backupDirectory)).rejects.toMatchObject({ code: "ENOENT" });

    const firstBody = await readFile(filePath, "utf8");
    const store = openStore(filePath, backupDirectory);
    await store.initialize(START);
    expect(await readdir(backupDirectory)).toEqual(["state-20261114.json"]);
    expect(
      await readFile(path.join(backupDirectory, "state-20261114.json"), "utf8"),
    ).toBe(firstBody);

    // The copy holds the state from before this run, and a second start on
    // the same day does not replace it.
    await store.update((state) => {
      state.nextRoleId = 42;
    });
    await openStore(filePath, backupDirectory).initialize(START + 3_600_000);
    expect(
      await readFile(path.join(backupDirectory, "state-20261114.json"), "utf8"),
    ).toBe(firstBody);

    for (let day = 1; day <= 4; day++) {
      await openStore(filePath, backupDirectory).initialize(START + day * DAY);
    }
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261116.json",
      "state-20261117.json",
      "state-20261118.json",
    ]);
    expect(
      JSON.parse(
        await readFile(path.join(backupDirectory, "state-20261118.json"), "utf8"),
      ).nextRoleId,
    ).toBe(42);
  });

  it("makes no copies when the count is zero", async () => {
    const { filePath, backupDirectory } = await workspace();
    await openStore(filePath, backupDirectory, 0).initialize(START);
    await openStore(filePath, backupDirectory, 0).initialize(START + DAY);
    await expect(readdir(backupDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves unrelated files in the backup directory alone", async () => {
    const { filePath, backupDirectory } = await workspace();
    await openStore(filePath, backupDirectory, 1).initialize(START);
    await openStore(filePath, backupDirectory, 1).initialize(START);
    await writeFile(path.join(backupDirectory, "notes.txt"), "keep me", "utf8");
    await openStore(filePath, backupDirectory, 1).initialize(START + DAY);
    expect((await readdir(backupDirectory)).sort()).toEqual([
      "notes.txt",
      "state-20261115.json",
    ]);
  });
});

describe("backup retention with a moved clock", () => {
  it("ranks today first, then earlier days, then days after today", () => {
    expect(
      rankBackups(
        [
          "state-20261120.json",
          "state-20261112.json",
          "state-20261114.json",
          "state-20261116.json",
          "state-20261113.json",
        ],
        "20261114",
      ),
    ).toEqual([
      "state-20261114.json",
      "state-20261113.json",
      "state-20261112.json",
      "state-20261116.json",
      "state-20261120.json",
    ]);
  });

  it("keeps real daily copies when the clock was set forward and back", async () => {
    const { filePath, backupDirectory } = await workspace();
    await openStore(filePath, backupDirectory).initialize(START);
    // The clock runs a week ahead for three starts, then returns.
    for (const day of [7, 8, 9]) {
      await openStore(filePath, backupDirectory).initialize(START + day * DAY);
    }
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261121.json",
      "state-20261122.json",
      "state-20261123.json",
    ]);

    await openStore(filePath, backupDirectory).initialize(START);
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261114.json",
      "state-20261121.json",
      "state-20261122.json",
    ]);
    await openStore(filePath, backupDirectory).initialize(START + DAY);
    await openStore(filePath, backupDirectory).initialize(START + 2 * DAY);
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261114.json",
      "state-20261115.json",
      "state-20261116.json",
    ]);
  });

  it("removes a temporary file left by an interrupted copy", async () => {
    const { filePath, backupDirectory } = await workspace();
    await openStore(filePath, backupDirectory).initialize(START);
    await openStore(filePath, backupDirectory).initialize(START);
    await writeFile(
      path.join(backupDirectory, "state-20261113.json.4242.tmp"),
      "partial",
      "utf8",
    );
    await openStore(filePath, backupDirectory).initialize(START + DAY);
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261114.json",
      "state-20261115.json",
    ]);
  });
});

describe("unreadable saves", () => {
  it("keeps a broken save and stops instead of starting a new game", async () => {
    const { filePath, backupDirectory } = await workspace();
    await openStore(filePath, backupDirectory).initialize(START);
    await openStore(filePath, backupDirectory).initialize(START);
    await writeFile(filePath, '{"schemaVersion":1,"players":{', "utf8");

    const failure = await openStore(filePath, backupDirectory)
      .initialize(START + DAY)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SaveFileError);
    const error = failure as SaveFileError;
    expect(error.preservedPath).toBe(`${filePath}.corrupt-20261115T063005Z`);
    expect(error.latestBackupPath).toBe(
      path.join(backupDirectory, "state-20261114.json"),
    );
    expect(await readFile(error.preservedPath, "utf8")).toBe(
      '{"schemaVersion":1,"players":{',
    );
    // The broken file is still in place and no backup of it was taken.
    expect(await readFile(filePath, "utf8")).toBe('{"schemaVersion":1,"players":{');
    expect(await readdir(backupDirectory)).toEqual(["state-20261114.json"]);

    // A restart loop reuses the copy; a different broken file gets its own.
    const again = (await openStore(filePath, backupDirectory)
      .initialize(START + DAY + 60_000)
      .catch((error: unknown) => error)) as SaveFileError;
    expect(again.preservedPath).toBe(error.preservedPath);
    await writeFile(filePath, "not json", "utf8");
    const other = (await openStore(filePath, backupDirectory)
      .initialize(START + DAY + 120_000)
      .catch((error: unknown) => error)) as SaveFileError;
    expect(other.preservedPath).toBe(`${filePath}.corrupt-20261115T063205Z`);
    expect(
      (await readdir(path.dirname(filePath))).filter((name) =>
        name.includes(".corrupt-"),
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["an empty file", ""],
    ["a root that is not an object", "[]"],
    ["a newer schema", '{"schemaVersion":2,"players":{},"updatedAt":null}'],
    ["a missing players map", '{"schemaVersion":1,"updatedAt":null}'],
    [
      "a player without lists",
      '{"schemaVersion":1,"players":{"a":{"account":"a"}},"updatedAt":null}',
    ],
  ])("rejects %s", async (_name, body) => {
    const { filePath, backupDirectory } = await workspace();
    await writeFile(filePath, body, "utf8");
    await expect(
      openStore(filePath, backupDirectory).initialize(START),
    ).rejects.toBeInstanceOf(SaveFileError);
    expect(await readFile(filePath, "utf8")).toBe(body);
  });

  it("loads a save written by the repository", async () => {
    const { filePath, backupDirectory } = await workspace();
    const store = openStore(filePath, backupDirectory);
    await store.initialize(START);
    const repository = new PlayerRepository({
      store,
      defaults: {
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        firstLevelComplete: false,
      },
      logger,
    });
    await repository.getOrCreate("tester");
    await store.flush();

    const reopened = openStore(filePath, backupDirectory);
    await reopened.initialize(START + DAY);
    expect(reopened.snapshot().players.tester?.account).toBe("tester");
  });
});
