import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigModule } from "../config.js";
import { runConfigCommand } from "../commands/config.js";

describe("config read", () => {
  let tmpDir: string;
  let config: ReturnType<typeof createConfigModule>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-config-test-"));
    config = createConfigModule(tmpDir);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("yields built-in defaults when no config file exists", () => {
    expect(config.readEffectiveConfig()).toEqual({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      focusEndSound: "Glass",
      breakEndSound: "Submarine",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("merges a partial config file over built-in defaults", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({ focusMinutes: 50, focusEndSound: "Ping" }),
      "utf8",
    );

    expect(config.readEffectiveConfig()).toEqual({
      focusMinutes: 50,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      focusEndSound: "Ping",
      breakEndSound: "Submarine",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and yields defaults when config JSON is malformed", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "config.json"), "{", "utf8");

    expect(config.readEffectiveConfig()).toEqual({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      focusEndSound: "Glass",
      breakEndSound: "Submarine",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring malformed config"),
    );
  });

  it("warns and falls back per invalid value while keeping valid sibling keys", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({
        focusMinutes: 0,
        shortBreakMinutes: -1,
        longBreakMinutes: "15",
        longBreakEvery: 2,
        focusEndSound: "UnknownSound",
        breakEndSound: "Ping",
        extraKey: "ignored",
      }),
      "utf8",
    );

    expect(config.readEffectiveConfig()).toEqual({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 2,
      focusEndSound: "Glass",
      breakEndSound: "Ping",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid config value for focusMinutes"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid config value for shortBreakMinutes"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid config value for longBreakMinutes"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid config value for focusEndSound"),
    );
  });
});

describe("config command reads", () => {
  it("prints effective config as JSON", () => {
    const writes: string[] = [];

    runConfigCommand({
      args: { json: true },
      config: {
        readEffectiveConfig: () => ({
          focusMinutes: 50,
          shortBreakMinutes: 5,
          longBreakMinutes: 15,
          longBreakEvery: 4,
          focusEndSound: "Glass",
          breakEndSound: "Submarine",
        }),
      },
      stdout: (text) => writes.push(text),
    });

    expect(JSON.parse(writes.join(""))).toEqual({
      focusMinutes: 50,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      focusEndSound: "Glass",
      breakEndSound: "Submarine",
    });
  });

  it("prints one effective value for get <key>", () => {
    const writes: string[] = [];

    runConfigCommand({
      args: { command: "get", key: "focusMinutes" },
      config: {
        readEffectiveConfig: () => ({
          focusMinutes: 50,
          shortBreakMinutes: 5,
          longBreakMinutes: 15,
          longBreakEvery: 4,
          focusEndSound: "Glass",
          breakEndSound: "Submarine",
        }),
      },
      stdout: (text) => writes.push(text),
    });

    expect(writes.join("")).toBe("50\n");
  });
});

describe("config command writes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists set values so later gets reflect them", () => {
    const config = createConfigModule(tmpDir);
    const writes: string[] = [];

    runConfigCommand({
      args: { command: "set", key: "focusMinutes", value: "50" },
      config,
      stdout: (text) => writes.push(text),
    });

    runConfigCommand({
      args: { command: "get", key: "focusMinutes" },
      config,
      stdout: (text) => writes.push(text),
    });

    expect(writes.join("")).toBe("focusMinutes=50\n50\n");
  });

  it("rejects invalid set values without writing a config file", () => {
    const config = createConfigModule(tmpDir);

    expect(() =>
      runConfigCommand({
        args: { command: "set", key: "focusMinutes", value: "0" },
        config,
      }),
    ).toThrow("Invalid config value for focusMinutes");

    expect(existsSync(join(tmpDir, "config.json"))).toBe(false);
  });

  it("preserves unknown keys when setting a known value", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({ extraKey: "keep-me", focusMinutes: 25 }),
      "utf8",
    );
    const config = createConfigModule(tmpDir);

    runConfigCommand({
      args: { command: "set", key: "shortBreakMinutes", value: "10" },
      config,
      stdout: () => {},
    });

    expect(
      JSON.parse(readFileSync(join(tmpDir, "config.json"), "utf8")),
    ).toEqual({
      extraKey: "keep-me",
      focusMinutes: 25,
      shortBreakMinutes: 10,
    });
  });
});
