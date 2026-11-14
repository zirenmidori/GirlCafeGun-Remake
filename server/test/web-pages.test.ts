import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMPTY_NOTICE, loadWebPages } from "../src/servers/web-pages.js";
import { mkdtemp } from "./helpers/temp.js";

const NOTICE = {
  bannerLoopTime: 3,
  banners: [],
  notices: [
    {
      ID: 7,
      forceShow: 0,
      priority: 2,
      date: "2026-11-14",
      title: "<b>Title</b>",
      content: "Line 1\nLine 2",
      startTime: "2000-01-01T00:00:00",
      endTime: "2099-01-01T00:00:00",
      extra: "kept",
    },
  ],
  activity: [],
  news: [],
  LoginNotice: [],
};

describe("static pages of the web windows", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(process.cwd(), "test/.tmp/web-pages-unit-"));
    await mkdir(path.join(root, "Notice/img"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "root");
    await writeFile(path.join(root, "Notice/Index.HTML"), "notice");
    await writeFile(path.join(root, "Notice/style.css"), "body{}");
    await writeFile(path.join(root, "Notice/img/dot.png"), Buffer.from([0x89, 0x50]));
    await writeFile(path.join(root, "Notice/data.bin"), Buffer.from([1, 2, 3]));
    await writeFile(
      path.join(root, "notice.txt"),
      String.fromCharCode(0xfeff) + JSON.stringify(NOTICE),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists every file with a lower-case path", () => {
    expect(loadWebPages(root).paths).toEqual([
      "index.html",
      "notice.txt",
      "notice/data.bin",
      "notice/img/dot.png",
      "notice/index.html",
      "notice/style.css",
    ]);
  });

  it("resolves a file, a folder with a slash and a folder without one", () => {
    const pages = loadWebPages(root);
    for (const address of [
      "/web/notice/index.html",
      "/web/notice/",
      "/web/notice",
      "/web/NOTICE/",
      "/web/notice%2Findex.html",
    ]) {
      expect(pages.get(address)?.body.toString(), address).toBe("notice");
    }
    expect(pages.get("/web/")?.body.toString()).toBe("root");
    expect(pages.get("/web/notice/img/dot.png")?.body).toEqual(
      Buffer.from([0x89, 0x50]),
    );
  });

  it("chooses the content type from the file name", () => {
    const pages = loadWebPages(root);
    expect(pages.get("/web/notice/")?.contentType).toBe("text/html; charset=utf-8");
    expect(pages.get("/web/notice/style.css")?.contentType).toBe(
      "text/css; charset=utf-8",
    );
    expect(pages.get("/web/notice/img/dot.png")?.contentType).toBe("image/png");
    expect(pages.get("/web/notice.txt")?.contentType).toBe("text/plain; charset=utf-8");
    expect(pages.get("/web/notice/data.bin")?.contentType).toBe(
      "application/octet-stream",
    );
  });

  it("finds nothing outside /web/ and nothing outside the folder", () => {
    const pages = loadWebPages(root);
    for (const address of [
      "/notice/index.html",
      "/web",
      "/webnotice/",
      "/web/../index.html",
      "/web/notice/../../index.html",
      "/web/none",
      "/web/%zz",
    ]) {
      expect(pages.get(address), address).toBeUndefined();
    }
  });

  it("reads the notice lists, with a byte order mark and with fields it does not know", () => {
    const pages = loadWebPages(root);
    expect(pages.noticeProblem).toBeUndefined();
    expect(JSON.parse(pages.notice.toString())).toEqual(NOTICE);
  });

  it("gives an empty notice document when the file is absent or not valid", async () => {
    const absent = loadWebPages(path.join(root, "none"));
    expect(absent.paths).toEqual([]);
    expect(absent.noticeProblem).toBe("file not found");
    expect(JSON.parse(absent.notice.toString())).toEqual(EMPTY_NOTICE);

    const other = await mkdtemp(path.join(process.cwd(), "test/.tmp/web-pages-unit-"));
    try {
      for (const text of [
        "not json",
        "[]",
        JSON.stringify({ ...NOTICE, news: [{}] }),
      ]) {
        await writeFile(path.join(other, "notice.txt"), text);
        const pages = loadWebPages(other);
        expect(pages.noticeProblem, text).toBeTruthy();
        expect(JSON.parse(pages.notice.toString()), text).toEqual(EMPTY_NOTICE);
      }
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("ships a notice file that is valid, and pages that ask no other host", async () => {
    const shipped = path.resolve(process.cwd(), "resources/web");
    const pages = loadWebPages(shipped);
    expect(pages.noticeProblem).toBeUndefined();
    expect(pages.paths).toEqual([
      "maintenance/index.html",
      "notice.txt",
      "notice/index.html",
      "offline/index.html",
    ]);
    for (const name of pages.paths.filter((item) => item.endsWith(".html"))) {
      const text = await readFile(path.join(shipped, name), "utf8");
      expect(text, name).not.toMatch(/(src|href|url)\s*[=(]\s*["']?(https?:)?\/\//i);
    }
  });
});
