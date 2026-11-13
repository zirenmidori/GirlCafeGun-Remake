import { once } from "node:events";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { createHttpServer } from "../src/servers/http-server.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

it("identifies the owning process over HTTP so another app's server is not accepted", async () => {
  const config = await loadConfig(process.cwd());
  const startedAt = new Date().toISOString();
  const server = createHttpServer({ config, logger, startedAt });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a listening TCP address");
    }
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      pid: process.pid,
      startedAt,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
