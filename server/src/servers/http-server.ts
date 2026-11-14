import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { loadWebPages } from "./web-pages.js";

interface HttpServerOptions {
  config: AppConfig;
  logger: Logger;
  startedAt: string;
  /** Folder of the static pages. Default: `resources/web` of the working directory. */
  webRoot?: string;
}

const JSON_TYPE = "application/json; charset=utf-8";

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  payload: Buffer,
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(payload);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, JSON_TYPE, Buffer.from(JSON.stringify(body)));
}

export function createHttpServer({
  config,
  logger,
  startedAt,
  webRoot = path.resolve(process.cwd(), "resources/web"),
}: HttpServerOptions): Server {
  const serverList = {
    serverlist: [
      {
        id: config.serverList.id,
        aid: config.serverList.aid,
        sid: config.serverList.sid,
        name: config.serverList.name,
        ip: config.gateway.advertisedHost,
        port: [config.gateway.port],
        state: config.serverList.state,
      },
    ],
    level: config.serverList.level,
  };

  const pages = loadWebPages(webRoot);
  if (pages.paths.length === 0) {
    logger.warn("http.web_pages_missing", { root: webRoot });
  } else {
    logger.info("http.web_pages", { root: webRoot, paths: pages.paths });
  }
  if (pages.noticeProblem !== undefined) {
    logger.warn("http.notice_unusable", {
      root: webRoot,
      problem: pages.noticeProblem,
    });
  }

  return createServer((request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? config.http.host}`,
    );
    logger.info("http.request", {
      remote: request.socket.remoteAddress,
      method: request.method,
      path: `${url.pathname}${url.search}`,
    });

    if (url.pathname === "/serverlist") {
      sendJson(response, 200, serverList);
    } else if (url.pathname.startsWith("/serverstate/")) {
      sendJson(response, 200, { state: config.serverList.state });
    } else if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        startedAt,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    } else if (url.pathname === "/notice.txt") {
      // The notice lists. The Notice page reads them; so can the client's own reader.
      send(response, 200, JSON_TYPE, pages.notice);
    } else {
      // /notice.html is the address the patched client asks for in its Notice window.
      const page = pages.get(
        url.pathname === "/notice.html" ? "/web/notice/index.html" : url.pathname,
      );
      if (page !== undefined) {
        send(response, 200, page.contentType, page.body);
      } else {
        sendJson(response, 404, { error: "not_found", path: url.pathname });
      }
    }
  });
}
