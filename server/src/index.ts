#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import type { Server } from "node:net";

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { JsonStore } from "./persistence/json-store.js";
import {
  assertLoadableState,
  makeInitialState,
  PlayerRepository,
} from "./persistence/player-repository.js";
import { createGatewayServer } from "./servers/gateway-server.js";
import { createHttpServer } from "./servers/http-server.js";
import { createPvpFightServers } from "./servers/pvp-fight-server.js";
import { PvpSessionManager } from "./game-data/pvp-session.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const config = await loadConfig(projectRoot);
const logger = createLogger({
  level: config.logging.level,
  filePath: config.logging.file,
  maxBytes: config.logging.maxBytes,
  maxFiles: config.logging.maxFiles,
});
const startedAt = new Date().toISOString();

const store = new JsonStore({
  filePath: config.persistence.file,
  initialState: makeInitialState(),
  logger,
  ...(config.persistence.backupDirectory
    ? {
        backups: {
          directory: config.persistence.backupDirectory,
          keep: config.persistence.backupCount ?? 0,
        },
      }
    : {}),
  validate: assertLoadableState,
});
await store.initialize();

const players = new PlayerRepository({
  store,
  defaults: config.playerDefaults,
  welcomeGifts: config.release?.welcomeGift ?? false,
  logger,
});

const httpServer = createHttpServer({ config, logger, startedAt });
const pvpSessions = new PvpSessionManager({
  robotCount: config.pvp.robotCount,
  roomCloseSeconds: config.pvp.roomCloseSeconds,
});
const gatewayServer = createGatewayServer({ config, logger, players, pvpSessions });

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, resolve);
  });
}

const pvpFightServers = createPvpFightServers({
  config,
  logger,
  sessions: pvpSessions,
});

await Promise.all([
  listen(httpServer, config.http.port, config.http.host),
  listen(gatewayServer, config.gateway.port, config.gateway.host),
  listen(pvpFightServers.tcp, config.pvp.fightPort, config.pvp.fightHost),
  new Promise<void>((resolve, reject) => {
    pvpFightServers.udp.once("error", reject);
    pvpFightServers.udp.bind(config.pvp.fightPort, config.pvp.fightHost, () =>
      resolve(),
    );
  }),
]);

logger.info("server.started", {
  pid: process.pid,
  http: `${config.http.host}:${config.http.port}`,
  gateway: `${config.gateway.host}:${config.gateway.port}`,
  advertisedGateway: `${config.gateway.advertisedHost}:${config.gateway.port}`,
  pvpFight: `${config.pvp.fightHost}:${config.pvp.fightPort} (tcp+udp)`,
  stateFile: config.persistence.file,
  logFile: config.logging.file,
});

let shuttingDown = false;
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.stopping", { signal });
  await Promise.all([
    closeServer(httpServer),
    closeServer(gatewayServer),
    closeServer(pvpFightServers.tcp),
  ]);
  pvpFightServers.udp.close();
  await store.flush();
  logger.info("server.stopped");
  await logger.close();
}

const shutdownSignals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of shutdownSignals) {
  process.on(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  });
}

process.on("uncaughtException", (error: Error) => {
  logger.error("process.uncaught_exception", {
    message: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (error) => {
  logger.error("process.unhandled_rejection", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});
