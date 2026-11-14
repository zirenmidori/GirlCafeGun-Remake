import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import {
  DEFAULT_GACHA_ROTATION_DAYS,
  MAX_GACHA_ROTATION_DAYS,
} from "./game-data/gacha-rotation-data.js";

export const DEFAULT_SAVE_BACKUP_COUNT = 7;
export const MAX_SAVE_BACKUP_COUNT = 365;

const configSchema = z.object({
  release: z
    .object({
      singlePlayerAccount: z.string().min(1),
      welcomeGift: z.boolean(),
    })
    .optional(),
  gachaRotationDays: z.number().int().min(0).max(MAX_GACHA_ROTATION_DAYS).optional(),
  http: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
  }),
  gateway: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    advertisedHost: z.string().min(1),
    maxPacketBytes: z.number().int().positive(),
  }),
  serverList: z.object({
    id: z.number().int().positive(),
    aid: z.number().int().positive(),
    sid: z.number().int().positive(),
    name: z.string().min(1),
    state: z.number().int(),
    level: z.number().int(),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    file: z.string().min(1),
    maxBytes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    maxPayloadHexBytes: z.number().int().positive(),
  }),
  persistence: z.object({
    file: z.string().min(1),
    backupDirectory: z.string().min(1).optional(),
    backupCount: z.number().int().min(0).max(MAX_SAVE_BACKUP_COUNT).optional(),
  }),
  pvp: z.object({
    fightHost: z.string().min(1),
    fightPort: z.number().int().min(1).max(65_535),
    robotCount: z.number().int().min(0).max(3),
    roomCloseSeconds: z.number().int().positive(),
  }),
  playerDefaults: z.object({
    name: z.string(),
    level: z.number().int().positive(),
    exp: z.number().int().nonnegative(),
    fightPower: z.number().int().nonnegative(),
    serverZone: z.number().int(),
    firstLevelComplete: z.boolean(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

function envInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer, received ${raw}`);
  }
  return value;
}

export async function loadConfig(projectRoot: string): Promise<AppConfig> {
  const configPath = path.join(projectRoot, "config", "default.json");
  let rawConfig: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (process.env.GCG_RELEASE_PROFILE === "1") {
    const release = JSON.parse(
      await readFile(path.join(projectRoot, "config", "release.json"), "utf8"),
    );
    rawConfig = { ...(rawConfig as object), ...release };
  }
  const config = configSchema.parse(rawConfig);
  const rotationOverride = process.env.GCG_GACHA_ROTATION_DAYS;
  config.gachaRotationDays = configSchema.shape.gachaRotationDays.parse(
    rotationOverride === undefined
      ? (config.gachaRotationDays ?? DEFAULT_GACHA_ROTATION_DAYS)
      : /^\d+$/.test(rotationOverride)
        ? Number(rotationOverride)
        : NaN,
  );

  config.http.host = process.env.GCG_HTTP_HOST ?? config.http.host;
  config.http.port = envInteger(
    "GCG_HTTP_PORT",
    envInteger("GCG_PORT", config.http.port),
  );
  config.gateway.host = process.env.GCG_GATEWAY_HOST ?? config.gateway.host;
  config.gateway.port = envInteger(
    "GCG_GATEWAY_PORT",
    envInteger("GCG_GAME_PORT", config.gateway.port),
  );
  config.gateway.advertisedHost =
    process.env.GCG_GAME_HOST ?? config.gateway.advertisedHost;
  config.pvp.fightHost = process.env.GCG_PVP_FIGHT_HOST ?? config.pvp.fightHost;
  config.pvp.fightPort = envInteger("GCG_PVP_FIGHT_PORT", config.pvp.fightPort);
  if (process.env.GCG_LOG_LEVEL !== undefined) {
    config.logging.level = configSchema.shape.logging.shape.level.parse(
      process.env.GCG_LOG_LEVEL,
    );
  }

  config.logging.file = path.resolve(
    projectRoot,
    process.env.GCG_LOG_FILE || config.logging.file,
  );
  config.persistence.file = path.resolve(
    projectRoot,
    process.env.GCG_STATE_FILE || config.persistence.file,
  );
  // Daily save copies live next to the save unless a directory is configured.
  config.persistence.backupDirectory = path.resolve(
    projectRoot,
    process.env.GCG_STATE_BACKUP_DIR ||
      config.persistence.backupDirectory ||
      path.join(path.dirname(config.persistence.file), "backups"),
  );
  config.persistence.backupCount =
    configSchema.shape.persistence.shape.backupCount.parse(
      envInteger(
        "GCG_STATE_BACKUP_COUNT",
        config.persistence.backupCount ?? DEFAULT_SAVE_BACKUP_COUNT,
      ),
    );
  return config;
}
