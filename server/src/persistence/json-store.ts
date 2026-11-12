import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logger.js";

interface PersistedDocument {
  updatedAt: string | null;
}

interface JsonStoreOptions<T extends PersistedDocument> {
  filePath: string;
  initialState: T;
  logger: Logger;
}

export class JsonStore<T extends PersistedDocument> {
  readonly #filePath: string;
  readonly #initialState: T;
  readonly #logger: Logger;
  #state: T | undefined;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor({ filePath, initialState, logger }: JsonStoreOptions<T>) {
    this.#filePath = filePath;
    this.#initialState = initialState;
    this.#logger = logger;
  }

  async initialize() {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      this.#state = JSON.parse(await readFile(this.#filePath, "utf8"));
      this.#logger.info("persistence.loaded", {
        file: this.#filePath,
      });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#state = structuredClone(this.#initialState);
      await this.#persist(this.#state);
      this.#logger.info("persistence.created", { file: this.#filePath });
    }
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
    await writeFile(tempPath, body, "utf8");
    await rename(tempPath, this.#filePath);
  }
}
