import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { LogFields, Logger } from "../src/logger.js";
import { createHttpServer } from "../src/servers/http-server.js";
import { mkdtemp } from "./helpers/temp.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

async function withServer(
  options: { webRoot?: string; logger?: Logger },
  run: (base: string, startedAt: string) => Promise<void>,
): Promise<void> {
  const config = await loadConfig(process.cwd());
  const startedAt = new Date().toISOString();
  const server: Server = createHttpServer({ config, logger, startedAt, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a listening TCP address");
    }
    await run(`http://127.0.0.1:${address.port}`, startedAt);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

it("identifies the owning process over HTTP so another app's server is not accepted", async () => {
  await withServer({}, async (base, startedAt) => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      pid: process.pid,
      startedAt,
    });
  });
});

it("serves the local pages of the web windows", async () => {
  await withServer({}, async (base) => {
    const notice = await fetch(`${base}/notice.html?1763100000`);
    expect(notice.status).toBe(200);
    expect(notice.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(notice.headers.get("cache-control")).toBe("no-store");
    const noticePage = await notice.text();
    expect(noticePage).toContain("<title>Notice</title>");
    // The page asks this server for its data, and nothing else.
    expect(noticePage).toContain('"/notice.txt?rnd="');
    expect(noticePage).not.toMatch(/https?:\/\//);

    for (const address of [
      "/web/notice/index.html",
      "/web/notice/",
      "/web/notice",
      "/web/NOTICE/Index.html",
    ]) {
      const same = await fetch(`${base}${address}`);
      expect(same.status, address).toBe(200);
      expect(await same.text(), address).toBe(noticePage);
    }

    const maintenance = await fetch(`${base}/web/maintenance/index.html?time=1`);
    expect(maintenance.status).toBe(200);
    expect(maintenance.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await maintenance.text()).toContain("The game server did not answer");

    const offline = await fetch(`${base}/web/offline/index.html`);
    expect(offline.status).toBe(200);
    expect(await offline.text()).toContain("This page is not in the offline build");
  });
});

it("serves the notice lists that the Notice page shows", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/notice.txt?rnd=0.5`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    const notice = (await response.json()) as {
      notices: unknown[];
      LoginNotice: unknown[];
    };
    expect(Object.keys(notice).sort()).toEqual([
      "LoginNotice",
      "activity",
      "bannerLoopTime",
      "banners",
      "news",
      "notices",
    ]);
    expect(notice.notices.length).toBeGreaterThan(0);
    expect(notice.notices[0]).toMatchObject({
      ID: expect.any(Number),
      priority: expect.any(Number),
      title: expect.any(String),
      content: expect.any(String),
      startTime: expect.any(String),
      endTime: expect.any(String),
    });
    // A login notice opens a window at every login.
    expect(notice.LoginNotice).toEqual([]);
  });
});

it("answers 404 for a page that does not exist and never leaves the page folder", async () => {
  await withServer({}, async (base) => {
    for (const address of [
      "/web/none.html",
      "/web/notice/none.html",
      "/web/%2e%2e/%2e%2e/config/default.json",
      "/web/..%2f..%2fconfig%2fdefault.json",
      "/web/%zz",
      "/notice.htm",
      "/",
    ]) {
      const response = await fetch(`${base}${address}`);
      expect(response.status, address).toBe(404);
      expect(await response.json(), address).toMatchObject({ error: "not_found" });
    }
    // The other routes are as before.
    expect((await fetch(`${base}/serverlist`)).status).toBe(200);
  });
});

it("starts without the page folder, and with a notice file that is not valid", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "test/.tmp/web-pages-"));
  try {
    const warnings: [string, LogFields | undefined][] = [];
    const recording: Logger = {
      ...logger,
      warn: (event, fields) => void warnings.push([event, fields]),
    };
    await withServer(
      { webRoot: path.join(root, "absent"), logger: recording },
      async (base) => {
        expect((await fetch(`${base}/notice.html`)).status).toBe(404);
        expect((await fetch(`${base}/web/notice/`)).status).toBe(404);
        const notice = await fetch(`${base}/notice.txt`);
        expect(notice.status).toBe(200);
        expect(await notice.json()).toEqual({
          bannerLoopTime: 5,
          banners: [],
          notices: [],
          activity: [],
          news: [],
          LoginNotice: [],
        });
        expect((await fetch(`${base}/health`)).status).toBe(200);
      },
    );
    expect(warnings.map(([event]) => event)).toEqual([
      "http.web_pages_missing",
      "http.notice_unusable",
    ]);

    warnings.length = 0;
    await mkdir(path.join(root, "web/notice"), { recursive: true });
    await writeFile(path.join(root, "web/notice/index.html"), "<p>page</p>");
    await writeFile(path.join(root, "web/notice.txt"), '{"notices": "none"}');
    await withServer(
      { webRoot: path.join(root, "web"), logger: recording },
      async (base) => {
        expect(await (await fetch(`${base}/notice.html`)).text()).toBe("<p>page</p>");
        const notice = (await (await fetch(`${base}/notice.txt`)).json()) as {
          notices: unknown[];
        };
        expect(notice.notices).toEqual([]);
      },
    );
    expect(warnings.map(([event]) => event)).toEqual(["http.notice_unusable"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
