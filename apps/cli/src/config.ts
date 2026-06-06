import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PmdrConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  dailyGoal: number;
  focusEndSound: string;
  breakEndSound: string;
}

export const DEFAULT_CONFIG: PmdrConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  dailyGoal: 8,
  focusEndSound: "Glass",
  breakEndSound: "Submarine",
};

const NUMBER_KEYS = [
  "focusMinutes",
  "shortBreakMinutes",
  "longBreakMinutes",
  "longBreakEvery",
  "dailyGoal",
] as const;
const SOUND_KEYS = ["focusEndSound", "breakEndSound"] as const;
type NumberKey = (typeof NUMBER_KEYS)[number];
type SoundKey = (typeof SOUND_KEYS)[number];
type ConfigKey = NumberKey | SoundKey;

const KNOWN_SOUND_NAMES = new Set([
  "Basso",
  "Blow",
  "Bottle",
  "Frog",
  "Funk",
  "Glass",
  "Hero",
  "Morse",
  "Ping",
  "Pop",
  "Purr",
  "Sosumi",
  "Submarine",
  "Tink",
]);

function isNumberKey(key: string): key is NumberKey {
  return (NUMBER_KEYS as readonly string[]).includes(key);
}

function isSoundKey(key: string): key is SoundKey {
  return (SOUND_KEYS as readonly string[]).includes(key);
}

function parseConfigValue(
  key: ConfigKey,
  value: unknown,
  options: { coerceNumberString?: boolean } = {},
): PmdrConfig[ConfigKey] {
  if (isNumberKey(key)) {
    const parsed =
      typeof value === "number"
        ? value
        : options.coerceNumberString && typeof value === "string"
          ? Number(value)
          : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    throw new Error(`Invalid config value for ${key}: ${value}`);
  }

  if (typeof value === "string" && KNOWN_SOUND_NAMES.has(value)) {
    return value;
  }

  throw new Error(`Invalid config value for ${key}: ${value}`);
}

export function defaultConfigDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "pmdr",
  );
}

export function createConfigModule(configDir: string = defaultConfigDir()) {
  const configFile = join(configDir, "config.json");

  function readRawConfig(): Record<string, unknown> {
    if (!existsSync(configFile)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(configFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  }

  function readEffectiveConfig(): PmdrConfig {
    if (!existsSync(configFile)) {
      return { ...DEFAULT_CONFIG };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(configFile, "utf8"));
    } catch (error) {
      console.warn(
        `Ignoring malformed config at ${configFile}: ${(error as Error).message}`,
      );
      return { ...DEFAULT_CONFIG };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_CONFIG };
    }

    const config: PmdrConfig = { ...DEFAULT_CONFIG };
    const raw = parsed as Record<string, unknown>;

    for (const key of NUMBER_KEYS) {
      const value = raw[key];
      if (value === undefined) continue;
      try {
        config[key] = parseConfigValue(key, value) as number;
      } catch {
        console.warn(`Invalid config value for ${key}; using default.`);
      }
    }

    for (const key of SOUND_KEYS) {
      const value = raw[key];
      if (value === undefined) continue;
      try {
        config[key] = parseConfigValue(key, value) as string;
      } catch {
        console.warn(`Invalid config value for ${key}; using default.`);
      }
    }

    return config;
  }

  function setConfigValue(key: string, rawValue: string): void {
    if (!isNumberKey(key) && !isSoundKey(key)) {
      throw new Error(`Unknown config key: ${key}`);
    }

    const value = parseConfigValue(key, rawValue, { coerceNumberString: true });
    const raw = readRawConfig();
    raw[key] = value;

    mkdirSync(configDir, { recursive: true });
    const tmpFile = `${configFile}.${process.pid}.tmp`;
    writeFileSync(tmpFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    renameSync(tmpFile, configFile);
  }

  return {
    readEffectiveConfig,
    setConfigValue,
  };
}
