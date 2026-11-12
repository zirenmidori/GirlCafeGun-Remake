import { createServer, type Server, type ServerResponse } from "node:http";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

interface HttpServerOptions {
  config: AppConfig;
  logger: Logger;
  startedAt: string;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(payload);
}

export function createHttpServer({
  config,
  logger,
  startedAt,
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
        startedAt,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    } else {
      sendJson(response, 404, { error: "not_found", path: url.pathname });
    }
  });
}
