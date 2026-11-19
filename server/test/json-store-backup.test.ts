import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { rename as renameCallback } from "node:fs";
import * as fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// The save write and the backup write must be flushed to disk before they
// are renamed into place, so mock the module and record the handle calls.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fsp>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
  };
});

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

describe("save writes", () => {
  it("syncs the save and the daily backup to disk before renaming them", async () => {
    const { filePath, backupDirectory } = await workspace();
    const store = openStore(filePath, backupDirectory);
    await store.initialize(START);

    const events: string[] = [];
    const openMock = vi.mocked(fsp).open;
    openMock.mockImplementation((target) => {
      const file = String(target);
      events.push(`open:${file}`);
      return Promise.resolve({
        writeFile: (body: string) => {
          events.push(`write:${file}`);
          return fsp.writeFile(file, body);
        },
        sync: () => {
          events.push(`sync:${file}`);
          return Promise.resolve();
        },
        close: () => {
          events.push(`close:${file}`);
          return Promise.resolve();
        },
      } as unknown as FileHandle);
    });
    const renameMock = vi.mocked(fsp).rename;
    renameMock.mockImplementation((from, to) => {
      events.push(`rename:${String(from)}->${String(to)}`);
      return new Promise<void>((resolve, reject) => {
        renameCallback(from, to, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    });

    try {
      await store.update((state) => {
        state.nextRoleId = 42;
      });
      await openStore(filePath, backupDirectory).initialize(START + DAY);
    } finally {
      openMock.mockRestore();
      renameMock.mockRestore();
    }

    const backupTarget = path.join(backupDirectory, "state-20261115.json");
    const pairs: Array<[string, string]> = [
      [`${filePath}.${process.pid}.tmp`, filePath],
      [`${backupTarget}.${process.pid}.tmp`, backupTarget],
    ];
    for (const [temp, final] of pairs) {
      const sync = events.indexOf(`sync:${temp}`);
      const close = events.indexOf(`close:${temp}`);
      const renamed = events.indexOf(`rename:${temp}->${final}`);
      expect(sync).toBeGreaterThanOrEqual(0);
      expect(close).toBeGreaterThanOrEqual(0);
      expect(renamed).toBeGreaterThanOrEqual(0);
      expect(sync).toBeLessThan(renamed);
      expect(close).toBeLessThan(renamed);
    }
    expect(JSON.parse(await readFile(filePath, "utf8")).nextRoleId).toBe(42);
    expect(await readFile(backupTarget, "utf8")).toBe(await readFile(filePath, "utf8"));
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

    // Starts dated before the newest copy still write their own copy but
    // remove nothing: either clock may be the wrong one.
    await openStore(filePath, backupDirectory).initialize(START);
    await openStore(filePath, backupDirectory).initialize(START + DAY);
    await openStore(filePath, backupDirectory).initialize(START + 2 * DAY);
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261114.json",
      "state-20261115.json",
      "state-20261116.json",
      "state-20261121.json",
      "state-20261122.json",
      "state-20261123.json",
    ]);

    // Once the clock passes the newest copy, trimming resumes.
    await openStore(filePath, backupDirectory).initialize(START + 10 * DAY);
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261122.json",
      "state-20261123.json",
      "state-20261124.json",
    ]);
  });

  it("keeps the real copies and adds today's when the clock is behind every backup", async () => {
    const { filePath, backupDirectory } = await workspace();
    // The first start of a fresh save creates it without a copy.
    await openStore(filePath, backupDirectory).initialize(START - DAY);
    await openStore(filePath, backupDirectory).initialize(START);
    await openStore(filePath, backupDirectory).initialize(START + DAY);
    await openStore(filePath, backupDirectory).initialize(START + 2 * DAY);

    await openStore(filePath, backupDirectory).initialize(Date.UTC(2000, 0, 1));
    expect(await readdir(backupDirectory)).toEqual([
      "state-20000101.json",
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
  it("keeps a broken save and stops instead of starting a new game when no backup loads", async () => {
    const { filePath, backupDirectory } = await workspace();
    await openStore(filePath, backupDirectory).initialize(START);
    await openStore(filePath, backupDirectory).initialize(START);
    await writeFile(filePath, '{"schemaVersion":1,"players":{', "utf8");
    // A loadable backup would now be restored (see "recovery from a daily
    // backup"), so this case breaks the only backup too.
    await writeFile(path.join(backupDirectory, "state-20261114.json"), "{", "utf8");

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

describe("recovery from a daily backup", () => {
  const BROKEN = '{"schemaVersion":1,"players":{';

  function saveBody(marker: string): string {
    return `${JSON.stringify({ ...makeInitialState(), updatedAt: marker }, null, 2)}\n`;
  }

  function recordingLogger() {
    const warnings: { event: string; fields: unknown }[] = [];
    const recorder: Logger = {
      ...logger,
      warn(event, fields) {
        warnings.push({ event, fields });
      },
    };
    return { recorder, warnings };
  }

  async function brokenSaveWithBackups(backups: Record<string, string>) {
    const { filePath, backupDirectory } = await workspace();
    await fsp.mkdir(backupDirectory, { recursive: true });
    for (const [name, body] of Object.entries(backups)) {
      await writeFile(path.join(backupDirectory, name), body, "utf8");
    }
    await writeFile(filePath, BROKEN, "utf8");
    return { filePath, backupDirectory };
  }

  it("loads the newest backup and keeps the broken save as state.json.corrupt-<time>", async () => {
    const { filePath, backupDirectory } = await brokenSaveWithBackups({
      "state-20261113.json": saveBody("older"),
      "state-20261114.json": saveBody("newest"),
    });
    const { recorder, warnings } = recordingLogger();
    const store = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger: recorder,
      backups: { directory: backupDirectory, keep: 3 },
      validate: assertLoadableState,
    });

    await store.initialize(START + DAY);

    expect(store.snapshot().updatedAt).toBe("newest");
    const brokenPath = `${filePath}.corrupt-20261115T063005Z`;
    expect(await readFile(brokenPath, "utf8")).toBe(BROKEN);
    expect(JSON.parse(await readFile(filePath, "utf8")).updatedAt).toBe("newest");
    expect(warnings).toContainEqual({
      event: "persistence.recovered_from_backup",
      fields: {
        file: filePath,
        broken: brokenPath,
        backup: path.join(backupDirectory, "state-20261114.json"),
      },
    });
    // The backups are left as they were: no copy of the recovered save is added.
    expect(await readdir(backupDirectory)).toEqual([
      "state-20261113.json",
      "state-20261114.json",
    ]);
    // A second start loads the recovered save normally.
    const reopened = openStore(filePath, backupDirectory);
    await reopened.initialize(START + DAY + 60_000);
    expect(reopened.snapshot().updatedAt).toBe("newest");
  });

  it("falls back to the backup before a broken newest backup", async () => {
    const { filePath, backupDirectory } = await brokenSaveWithBackups({
      "state-20261112.json": saveBody("oldest"),
      "state-20261113.json": saveBody("older"),
      "state-20261114.json": "{",
    });
    const store = openStore(filePath, backupDirectory);

    await store.initialize(START + DAY);

    expect(store.snapshot().updatedAt).toBe("older");
    expect(await readFile(`${filePath}.corrupt-20261115T063005Z`, "utf8")).toBe(BROKEN);
  });

  it("throws SaveFileError as before when no backup exists", async () => {
    const { filePath, backupDirectory } = await brokenSaveWithBackups({});

    await expect(
      openStore(filePath, backupDirectory).initialize(START + DAY),
    ).rejects.toBeInstanceOf(SaveFileError);
    expect(await readFile(filePath, "utf8")).toBe(BROKEN);
  });

  it("starts a fresh save when state.json is missing, even with backups (save tool wipe)", async () => {
    const { filePath, backupDirectory } = await workspace();
    await fsp.mkdir(backupDirectory, { recursive: true });
    await writeFile(
      path.join(backupDirectory, "state-20261114.json"),
      saveBody("old game"),
      "utf8",
    );
    const store = openStore(filePath, backupDirectory);

    await store.initialize(START + DAY);

    expect(store.snapshot()).toEqual(makeInitialState());
    expect(JSON.parse(await readFile(filePath, "utf8")).updatedAt).toBeNull();
    expect(await readdir(backupDirectory)).toEqual(["state-20261114.json"]);
  });
});
