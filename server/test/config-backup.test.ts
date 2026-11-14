import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SAVE_BACKUP_COUNT, loadConfig } from "../src/config.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const NAMES = ["GCG_STATE_FILE", "GCG_STATE_BACKUP_DIR", "GCG_STATE_BACKUP_COUNT"];
const saved = new Map(NAMES.map((name) => [name, process.env[name]]));

function setEnvironment(values: Record<string, string>) {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("save backup configuration", () => {
  it("keeps seven daily copies next to the save by default", async () => {
    setEnvironment({});
    const config = await loadConfig(projectRoot);
    expect(config.persistence.backupDirectory).toBe(
      path.join(path.dirname(config.persistence.file), "backups"),
    );
    expect(config.persistence.backupCount).toBe(DEFAULT_SAVE_BACKUP_COUNT);
  });

  it("follows a relocated save and accepts overrides", async () => {
    const stateFile = path.join(projectRoot, "test", ".tmp", "elsewhere", "state.json");
    setEnvironment({ GCG_STATE_FILE: stateFile });
    expect((await loadConfig(projectRoot)).persistence.backupDirectory).toBe(
      path.join(path.dirname(stateFile), "backups"),
    );

    const backupDirectory = path.join(projectRoot, "test", ".tmp", "copies");
    setEnvironment({
      GCG_STATE_BACKUP_DIR: backupDirectory,
      GCG_STATE_BACKUP_COUNT: "0",
    });
    const config = await loadConfig(projectRoot);
    expect(config.persistence.backupDirectory).toBe(backupDirectory);
    expect(config.persistence.backupCount).toBe(0);
  });

  it("rejects a count outside 0 to 365", async () => {
    setEnvironment({ GCG_STATE_BACKUP_COUNT: "366" });
    await expect(loadConfig(projectRoot)).rejects.toThrow();
    setEnvironment({ GCG_STATE_BACKUP_COUNT: "-1" });
    await expect(loadConfig(projectRoot)).rejects.toThrow();
  });
});
