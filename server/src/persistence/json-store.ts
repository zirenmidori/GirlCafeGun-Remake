import { copyFile, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logger.js";

interface PersistedDocument {
  updatedAt: string | null;
}

export interface JsonStoreBackupOptions {
  /** Directory that receives one copy of the save per UTC day. */
  directory: string;
  /** Number of daily copies to keep. Zero disables backups. */
  keep: number;
}

interface JsonStoreOptions<T extends PersistedDocument> {
  filePath: string;
  initialState: T;
  logger: Logger;
  backups?: JsonStoreBackupOptions;
  /** Throws when the parsed document is not a loadable save. */
  validate?: (document: unknown) => void;
}

/**
 * The save exists but cannot be loaded. The store never replaces such a file
 * with a fresh state: the broken bytes are preserved next to it first.
 */
export class SaveFileError extends Error {
  constructor(
    readonly filePath: string,
    readonly preservedPath: string,
    readonly latestBackupPath: string | null,
    reason: string,
  ) {
    super(
      `Save file ${filePath} cannot be loaded (${reason}). ` +
        `A copy was kept at ${preservedPath}. ` +
        (latestBackupPath
          ? `Latest daily backup: ${latestBackupPath}.`
          : "No daily backup exists."),
    );
    this.name = "SaveFileError";
  }
}

const BACKUP_NAME = /^state-(\d{8})\.json$/;
const BACKUP_TEMP_NAME = /^state-\d{8}\.json\.\d+\.tmp$/;

function compactDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10).replaceAll("-", "");
}

function compactTimestamp(now: number): string {
  return new Date(now)
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "");
}

async function listBackups(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => BACKUP_NAME.test(name)).sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Orders backup names from most to least worth keeping: today's copy, then
 * earlier days from newest to oldest, then days after today from nearest to
 * farthest. A copy dated after today was written while the device clock was
 * set forward, so its content is older than its name says; ranking it last
 * keeps such copies from pushing out every real daily backup.
 */
export function rankBackups(names: readonly string[], today: string): string[] {
  const current = `state-${today}.json`;
  const past = names.filter((name) => name <= current).sort();
  const future = names.filter((name) => name > current).sort();
  return [...past.reverse(), ...future];
}

/**
 * Writes the body and forces it to disk before closing, so a power loss
 * cannot leave a zero-length file where a save was renamed.
 */
export async function writeFileDurably(filePath: string, body: string): Promise<void> {
  const handle = await open(filePath, "w");
  try {
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class JsonStore<T extends PersistedDocument> {
  readonly #filePath: string;
  readonly #initialState: T;
  readonly #logger: Logger;
  readonly #backups: JsonStoreBackupOptions | undefined;
  readonly #validate: ((document: unknown) => void) | undefined;
  #state: T | undefined;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor({
    filePath,
    initialState,
    logger,
    backups,
    validate,
  }: JsonStoreOptions<T>) {
    this.#filePath = filePath;
    this.#initialState = initialState;
    this.#logger = logger;
    this.#backups = backups && backups.keep > 0 ? backups : undefined;
    this.#validate = validate;
  }

  async initialize(now = Date.now()) {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    let body: string;
    try {
      body = await readFile(this.#filePath, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#state = structuredClone(this.#initialState);
      await this.#persist(this.#state);
      this.#logger.info("persistence.created", { file: this.#filePath });
      return;
    }

    let document: unknown;
    try {
      document = this.#parse(body);
    } catch (error: unknown) {
      // The broken bytes are kept first (state.json.corrupt-<time>, reused for
      // an identical file), then the newest loadable daily backup replaces the
      // save. No daily copy after a recovery: the loaded content is a backup
      // already, and a new copy could push out an older real backup.
      const failure = await this.#preserveUnreadable(error, now);
      if (await this.#recoverFromBackup(failure.preservedPath, now)) return;
      throw failure;
    }
    this.#state = document as T;
    this.#logger.info("persistence.loaded", {
      file: this.#filePath,
    });
    await this.#backupDaily(body, now);
  }

  snapshot(): T {
    if (!this.#state) throw new Error("JsonStore is not initialized");
    return structuredClone(this.#state);
  }

  async update<R>(mutator: (draft: T) => R | Promise<R>): Promise<R> {
    if (!this.#state) throw new Error("JsonStore is not initialized");
    const operation = this.#writeQueue.then(async () => {
      const draft = structuredClone(this.#state as T);
      const result = await mutator(draft);
      draft.updatedAt = new Date().toISOString();
      await this.#persist(draft);
      this.#state = draft;
      return result;
    });
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async flush(): Promise<void> {
    await this.#writeQueue;
  }

  async #persist(state: T): Promise<void> {
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    const body = `${JSON.stringify(state, null, 2)}\n`;
    await writeFileDurably(tempPath, body);
    await rename(tempPath, this.#filePath);
  }

  #parse(body: string): unknown {
    const document: unknown = JSON.parse(body);
    this.#validate?.(document);
    return document;
  }

  /**
   * The only automatic save handling in the server: when the save cannot be
   * parsed, load the newest daily backup that parses. The caller has already
   * kept the broken bytes at `preservedPath`. A missing save never gets here:
   * it starts a fresh game, which the PC save tool's wipe relies on. Without a
   * loadable backup nothing is written and the caller reports the broken save.
   */
  async #recoverFromBackup(preservedPath: string, now: number): Promise<boolean> {
    const backups = this.#backups;
    if (!backups) return false;
    const names = rankBackups(await listBackups(backups.directory), compactDate(now));
    for (const name of names) {
      const backupPath = path.join(backups.directory, name);
      let document: unknown;
      try {
        document = this.#parse(await readFile(backupPath, "utf8"));
      } catch (error: unknown) {
        this.#logger.warn("persistence.backup_unreadable", {
          file: backupPath,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      this.#state = document as T;
      // Write the recovered save at once, so a stop before the first change
      // still leaves a loadable state.json.
      await this.#persist(this.#state);
      this.#logger.warn("persistence.recovered_from_backup", {
        file: this.#filePath,
        broken: preservedPath,
        backup: backupPath,
      });
      return true;
    }
    return false;
  }

  async #preserveUnreadable(error: unknown, now: number): Promise<SaveFileError> {
    let preservedPath = await this.#findPreservedCopy();
    if (!preservedPath) {
      preservedPath = `${this.#filePath}.corrupt-${compactTimestamp(now)}`;
      await copyFile(this.#filePath, preservedPath);
    }
    const backups = this.#backups ? await listBackups(this.#backups.directory) : [];
    const latest = rankBackups(backups, compactDate(now))[0];
    const failure = new SaveFileError(
      this.#filePath,
      preservedPath,
      latest && this.#backups ? path.join(this.#backups.directory, latest) : null,
      error instanceof Error ? error.message : String(error),
    );
    this.#logger.error("persistence.unreadable", {
      file: this.#filePath,
      preserved: preservedPath,
      latestBackup: failure.latestBackupPath,
      reason: failure.message,
    });
    return failure;
  }

  /**
   * A service that restarts in a loop must not fill the disk with copies of
   * the same broken save, so an identical earlier copy is reused.
   */
  async #findPreservedCopy(): Promise<string | null> {
    const directory = path.dirname(this.#filePath);
    const prefix = `${path.basename(this.#filePath)}.corrupt-`;
    const broken = await readFile(this.#filePath);
    for (const name of (await readdir(directory)).sort().reverse()) {
      if (!name.startsWith(prefix)) continue;
      const candidate = path.join(directory, name);
      if (broken.equals(await readFile(candidate))) return candidate;
    }
    return null;
  }

  /**
   * Copies the bytes that were just loaded, once per UTC day, before any
   * mutation of this run can reach the disk. A failed copy must not stop the
   * game, so it is only logged.
   */
  async #backupDaily(body: string, now: number): Promise<void> {
    const backups = this.#backups;
    if (!backups) return;
    const today = compactDate(now);
    const target = path.join(backups.directory, `state-${today}.json`);
    try {
      await mkdir(backups.directory, { recursive: true });
      // A crash between write and rename leaves a temporary file behind.
      for (const name of await readdir(backups.directory)) {
        if (BACKUP_TEMP_NAME.test(name)) {
          await rm(path.join(backups.directory, name), { force: true });
        }
      }
      const existing = await listBackups(backups.directory);
      // A copy dated after today means the clock is behind it now, or was
      // ahead when that copy was written. Either clock can be the wrong one,
      // so write today's copy but remove nothing until the clock passes the
      // newest copy: no real backup is lost either way.
      const newest = existing[existing.length - 1];
      const newestDate = newest ? BACKUP_NAME.exec(newest)?.[1] : undefined;
      const clockBehind = newestDate !== undefined && newestDate > today;
      if (!existing.includes(path.basename(target))) {
        const tempPath = `${target}.${process.pid}.tmp`;
        await writeFileDurably(tempPath, body);
        await rename(tempPath, target);
        existing.push(path.basename(target));
        this.#logger.info("persistence.backup_created", { file: target });
      }
      if (clockBehind) {
        this.#logger.warn("persistence.backup_trim_skipped", {
          file: target,
          newestBackup: newest,
        });
        return;
      }
      for (const name of rankBackups(existing, today).slice(backups.keep)) {
        await rm(path.join(backups.directory, name), { force: true });
        this.#logger.info("persistence.backup_removed", {
          file: path.join(backups.directory, name),
        });
      }
    } catch (error: unknown) {
      this.#logger.warn("persistence.backup_failed", {
        file: target,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
