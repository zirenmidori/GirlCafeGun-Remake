// SPDX-License-Identifier: MIT
// Ported from the C# server of GCG2-Offline (WebAssets.cs and the notice routes of
// BootstrapHttpServer.cs in SssjServer.Core), which is built on SssjServer
// (MIT, copyright 2025 luoxiadesu; LICENSES/SssjServer-MIT.txt).
//
// Static pages for the web windows of the client. The publisher's pages are gone, so
// the client is pointed at this server (release/client/patch_offline_web.py). The
// files live in resources/web/ and are read once, when the HTTP server is created.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

export interface WebPage {
  body: Buffer;
  contentType: string;
}

export interface WebPages {
  /** Paths below `/web/` that exist (forward slashes, lower case), sorted. */
  readonly paths: readonly string[];
  /** Body of `/notice.txt`: the notice lists, always a valid document. */
  readonly notice: Buffer;
  /** Why the notice file was not used, when it was not. */
  readonly noticeProblem: string | undefined;
  /** Resolves `/web/notice/index.html`, `/web/notice/` or `/web/notice`. */
  get(requestPath: string): WebPage | undefined;
}

const URL_PREFIX = "/web/";
const NOTICE_FILE = "notice.txt";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// The client's own reader of this document is NoticeHelper (C#): four lists of
// notices, the banners and the banner interval. The Notice page reads the same lists.
const noticeItemSchema = z.looseObject({
  ID: z.number().int(),
  forceShow: z.number().int(),
  priority: z.number().int(),
  date: z.string(),
  title: z.string(),
  content: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});

const noticeSchema = z.object({
  bannerLoopTime: z.number().nonnegative(),
  banners: z.array(z.looseObject({})),
  notices: z.array(noticeItemSchema),
  activity: z.array(noticeItemSchema),
  news: z.array(noticeItemSchema),
  LoginNotice: z.array(noticeItemSchema),
});

export type NoticeDocument = z.infer<typeof noticeSchema>;

export const EMPTY_NOTICE: NoticeDocument = Object.freeze({
  bannerLoopTime: 5,
  banners: [],
  notices: [],
  activity: [],
  news: [],
  LoginNotice: [],
});

function contentTypeOf(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

// A plain walk, without the recursive option of readdir: it does not depend on the
// version of the Node.js build inside the Android app.
function readTree(root: string): Map<string, WebPage> {
  const files = new Map<string, WebPage>();
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      const key = `${prefix}${entry.name}`.toLowerCase();
      if (entry.isDirectory()) {
        walk(file, `${key}/`);
      } else if (entry.isFile()) {
        files.set(key, {
          body: readFileSync(file),
          contentType: contentTypeOf(entry.name),
        });
      }
    }
  };
  if (existsSync(root)) walk(root, "");
  return files;
}

function readNotice(file: WebPage | undefined): {
  notice: NoticeDocument;
  problem?: string;
} {
  if (file === undefined) return { notice: EMPTY_NOTICE, problem: "file not found" };
  try {
    const raw = file.body.toString("utf8");
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return { notice: noticeSchema.parse(JSON.parse(text)) };
  } catch (error) {
    return {
      notice: EMPTY_NOTICE,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reads every file below `root`. A missing folder gives a set with no pages and an
 * empty notice document: the server still starts, and the routes answer 404.
 */
export function loadWebPages(root: string): WebPages {
  const files = readTree(root);
  const { notice, problem } = readNotice(files.get(NOTICE_FILE));
  return {
    paths: [...files.keys()].sort(),
    notice: Buffer.from(JSON.stringify(notice)),
    noticeProblem: problem,
    get(requestPath: string): WebPage | undefined {
      if (!requestPath.startsWith(URL_PREFIX)) return undefined;
      let relative: string;
      try {
        relative = decodeURIComponent(requestPath.slice(URL_PREFIX.length));
      } catch {
        return undefined;
      }
      relative = relative.toLowerCase();
      if (relative === "" || relative.endsWith("/")) relative += "index.html";
      return files.get(relative) ?? files.get(`${relative}/index.html`);
    },
  };
}
