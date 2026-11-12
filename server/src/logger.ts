import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const LEVEL_COLORS: Readonly<Record<LogLevel, string>> = Object.freeze({
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
});
const ANSI_RESET = "\u001b[0m";

export type LogLevel = keyof typeof LEVELS;
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  close(): Promise<void>;
}

interface LoggerOptions {
  level?: LogLevel;
  filePath: string;
  maxBytes?: number;
  maxFiles?: number;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function terminalSupportsColor(entryLevel: LogLevel): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === "0") {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined) return true;
  return entryLevel === "error" ? process.stderr.isTTY : process.stdout.isTTY;
}

function formatLevel(entryLevel: LogLevel, color: boolean): string {
  const label = entryLevel.toUpperCase().padEnd(5);
  return color ? `${LEVEL_COLORS[entryLevel]}${label}${ANSI_RESET}` : label;
}

export function createLogger({
  level = "info",
  filePath,
  maxBytes = 20 * 1024 * 1024,
  maxFiles = 5,
}: LoggerOptions): Logger {
  const threshold = LEVELS[level];
  if (threshold === undefined) {
    throw new Error(`Unknown log level: ${level}`);
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  let currentBytes = existsSync(filePath) ? statSync(filePath).size : 0;

  function rotate() {
    const oldest = `${filePath}.${maxFiles}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = `${filePath}.${index}`;
      if (existsSync(source)) renameSync(source, `${filePath}.${index + 1}`);
    }
    if (existsSync(filePath)) renameSync(filePath, `${filePath}.1`);
    currentBytes = 0;
  }

  function write(entryLevel: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVELS[entryLevel] < threshold) return;
    const suffix =
      Object.keys(fields).length === 0
        ? ""
        : ` ${JSON.stringify(fields, jsonReplacer)}`;
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${formatLevel(entryLevel, false)} ${event}${suffix}`;
    const terminalLine = `${timestamp} ${formatLevel(
      entryLevel,
      terminalSupportsColor(entryLevel),
    )} ${event}${suffix}`;
    if (entryLevel === "error") {
      console.error(terminalLine);
    } else {
      console.log(terminalLine);
    }
    const lineBytes = Buffer.byteLength(line) + 1;
    if (currentBytes > 0 && currentBytes + lineBytes > maxBytes) rotate();
    appendFileSync(filePath, `${line}\n`, "utf8");
    currentBytes += lineBytes;
  }

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    close: async () => {},
  };
}
