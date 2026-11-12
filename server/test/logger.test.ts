import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";

const originalForceColor = process.env.FORCE_COLOR;
const originalNoColor = process.env.NO_COLOR;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = originalForceColor;
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

it("colors only the terminal level field and keeps the log file plain", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-logger-"));
  const filePath = path.join(directory, "server.log");
  process.env.FORCE_COLOR = "1";
  delete process.env.NO_COLOR;
  const output = vi.spyOn(console, "log").mockImplementation(() => {});

  try {
    const logger = createLogger({ filePath, level: "debug" });
    logger.info("server.started", { port: 30_400 });

    expect(output).toHaveBeenCalledOnce();
    expect(String(output.mock.calls[0]?.[0])).toContain(
      `${String.fromCharCode(27)}[36mINFO ${String.fromCharCode(27)}[0m server.started`,
    );
    const fileContents = await readFile(filePath, "utf8");
    expect(fileContents).toContain('INFO  server.started {"port":30400}');
    expect(fileContents).not.toContain("\u001b[");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
