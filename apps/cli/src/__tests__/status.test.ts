import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("returns running with remainingMs, duration, startedAt", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(getStatus({ store, now: NOW })).toEqual({
      state: "running",
      remainingMs: 55_000,
      duration: 60_000,
      startedAt: NOW - 5_000,
    });
  });

  it("returns paused with frozen remainingMs, duration, startedAt", () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
    });
    // nominalEnd = (NOW-10000) + 60000 + 0 = NOW+50000
    // frozen at pausedAt=NOW-2000 → remaining = (NOW+50000) - (NOW-2000) = 52000
    expect(getStatus({ store, now: NOW })).toEqual({
      state: "paused",
      remainingMs: 52_000,
      duration: 60_000,
      startedAt: NOW - 10_000,
    });
  });

  it("finalizes an expired timer and returns idle", () => {
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    const result = getStatus({ store, now: NOW });
    expect(result).toEqual({ state: "idle" });
    expect(store.readState()).toBeNull();
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

  it("formats running with mm:ss remaining", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 1_122_000,
      duration: 1_500_000,
      startedAt: 0,
    };
    // 1122000ms = 18m42s
    expect(formatStatus(r)).toBe("running — 18:42 left");
  });

  it("formats paused with mm:ss remaining", () => {
    const r: StatusResult = {
      state: "paused",
      remainingMs: 1_122_000,
      duration: 1_500_000,
      startedAt: 0,
    };
    expect(formatStatus(r)).toBe("paused — 18:42 left");
  });

  it("formats 0s remaining as 0:00", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 0,
      duration: 60_000,
      startedAt: 0,
    };
    expect(formatStatus(r)).toBe("running — 0:00 left");
  });

  it("pads seconds below 10 with a leading zero", () => {
    const r: StatusResult = {
      state: "running",
      remainingMs: 65_000, // 1m5s
      duration: 60_000,
      startedAt: 0,
    };
    expect(formatStatus(r)).toBe("running — 1:05 left");
  });
});
