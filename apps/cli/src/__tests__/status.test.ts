import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, symlinkSync, mkdirSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStateModule } from "../state.js";
import { getStatus, formatStatus } from "../commands/status.js";
import type { StatusResult } from "../commands/status.js";

// ─── getStatus ────────────────────────────────────────────────────────────────

describe("getStatus", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns idle when no state file exists", () => {
    expect(getStatus({ store, now: NOW })).toEqual({ state: "idle" });
  });

  it("returns running with remainingMs, duration, startedAt, phase, completedFocusBlocks", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    expect(getStatus({ store, now: NOW })).toEqual({
      state: "running",
      remainingMs: 55_000,
      duration: 60_000,
      startedAt: NOW - 5_000,
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  it("returns paused with frozen remainingMs, duration, startedAt, phase, completedFocusBlocks", () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 2,
    });
    // nominalEnd = (NOW-10000) + 60000 + 0 = NOW+50000
    // frozen at pausedAt=NOW-2000 → remaining = (NOW+50000) - (NOW-2000) = 52000
    expect(getStatus({ store, now: NOW })).toEqual({
      state: "paused",
      remainingMs: 52_000,
      duration: 60_000,
      startedAt: NOW - 10_000,
      phase: "focus",
      completedFocusBlocks: 2,
    });
  });

  it("defaults missing phase/completedFocusBlocks to focus/0 for legacy records", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    const result = getStatus({ store, now: NOW });
    expect(result).toMatchObject({
      state: "running",
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  it("reports a break-running state with phase=break", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 5 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "break",
      completedFocusBlocks: 1,
    });
    expect(getStatus({ store, now: NOW })).toMatchObject({
      state: "running",
      phase: "break",
      completedFocusBlocks: 1,
    });
  });

  it("advances an expired focus to break and returns the running break state", () => {
    // focus: expires at NOW-70_000+60_000 = NOW-10_000
    // break: startedAt=NOW-10_000, durationMs=300_000 → still running at NOW
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    const result = getStatus({ store, now: NOW });
    expect(result.state).toBe("running");
    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.completedFocusBlocks).toBe(1);
  });

  it("appends a completion to log when lazy-finalizing an expired timer", () => {
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    getStatus({ store, now: NOW });
    const completionsFile = join(tmpDir, "completions.jsonl");
    expect(existsSync(completionsFile)).toBe(true);
    const lines = readFileSync(completionsFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.durationMs).toBe(60_000);
  });

  it("returns idle for a running timer that accounts for accumulated pauses", () => {
    store.writeState({
      startedAt: NOW - 30_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 10_000,
    });
    // nominalEnd = (NOW-30000) + 60000 + 10000 = NOW+40000 → still running
    const result = getStatus({ store, now: NOW });
    expect(result).toMatchObject({ state: "running", remainingMs: 40_000 });
  });
});

// ─── formatStatus ─────────────────────────────────────────────────────────────

describe("formatStatus", () => {
  it("formats idle", () => {
    const r: StatusResult = { state: "idle" };
    expect(formatStatus(r)).toBe("idle");
  });

  it("formats focus running with mm:ss remaining and block count", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 1_122_000,
      duration: 1_500_000,
      startedAt: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    };
    // 1122000ms = 18m42s
    expect(formatStatus(r)).toBe("focus — 18:42 left (block 1/4)");
  });

  it("formats focus paused with mm:ss remaining and block count", () => {
    const r: StatusResult = {
      state: "paused",
      remainingMs: 1_122_000,
      duration: 1_500_000,
      startedAt: 0,
      phase: "focus",
      completedFocusBlocks: 2,
    };
    expect(formatStatus(r)).toBe("focus paused — 18:42 left (block 3/4)");
  });

  it("formats break running with mm:ss remaining and completed blocks", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 270_000, // 4m30s
      duration: 300_000,
      startedAt: 0,
      phase: "break",
      completedFocusBlocks: 1,
    };
    expect(formatStatus(r)).toBe("break — 4:30 left (1/4 done)");
  });

  it("formats 0s remaining as 0:00", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 0,
      duration: 60_000,
      startedAt: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    };
    expect(formatStatus(r)).toBe("focus — 0:00 left (block 1/4)");
  });

  it("pads seconds below 10 with a leading zero", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 65_000, // 1m5s
      duration: 60_000,
      startedAt: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    };
    expect(formatStatus(r)).toBe("focus — 1:05 left (block 1/4)");
  });
});

// ─── CLI integration ─────────────────────────────────────────────────────────

describe("pmdr status --json", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(testDir, "../../../..");
  const cliDist = join(repoRoot, "apps/cli/dist/index.js");
  let tmpDir: string;

  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "cli", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-cli-status-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 with only valid JSON on stdout when stdin is non-interactive", () => {
    const binDir = join(tmpDir, "bin");
    const homeDir = join(tmpDir, "home");
    mkdirSync(binDir);
    mkdirSync(homeDir);
    symlinkSync(cliDist, join(binDir, "pmdr"));

    const result = spawnSync("pmdr", ["status", "--json"], {
      env: {
        HOME: homeDir,
        PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      },
      input: "",
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(JSON.parse(result.stdout)).toEqual({ state: "idle" });
  });
});
