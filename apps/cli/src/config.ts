import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PmdrConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  focusEndSound: string;
  breakEndSound: string;
}

export const DEFAULT_CONFIG: PmdrConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  focusEndSound: "Glass",
  breakEndSound: "Submarine",
};

const NUMBER_KEYS = [
  "focusMinutes",
  "shortBreakMinutes",
  "longBreakMinutes",
  "longBreakEvery",
] as const;
const SOUND_KEYS = ["focusEndSound", "breakEndSound"] as const;
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

export function defaultConfigDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "pmdr",
  );
}

export function createConfigModule(configDir: string = defaultConfigDir()) {
  const configFile = join(configDir, "config.json");

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
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        config[key] = value;
      } else {
        console.warn(`Invalid config value for ${key}; using default.`);
      }
    }

    for (const key of SOUND_KEYS) {
      const value = raw[key];
      if (value === undefined) continue;
      if (typeof value === "string" && KNOWN_SOUND_NAMES.has(value)) {
        config[key] = value;
      } else {
        console.warn(`Invalid config value for ${key}; using default.`);
      }
    }

    return config;
  }

  return {
    readEffectiveConfig,
  };
}
