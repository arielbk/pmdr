import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDuration } from "../parse-duration.js";
import { initTimer } from "../commands/start.js";
import { createStateModule } from "../state.js";

// ─── parseDuration ────────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it.each([
    ["25m", 1_500_000],
    ["10s", 10_000],
    ["1h", 3_600_000],
    ["500ms", 500],
    ["1.5m", 90_000],
    ["0s", 0],
    ["90s", 90_000],
  ])("parseDuration(%s) === %d", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(["foo", "25", "25x", "abc123", "", "m", "-5m"])(
    "throws on invalid: %s",
    (bad) => {
      expect(() => parseDuration(bad)).toThrow(/Invalid duration/);
    },
  );
});

// ─── initTimer ────────────────────────────────────────────────────────────────

describe("initTimer", () => {
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

  it("writes state when idle", () => {
    initTimer({ store, durationMs: 10_000, now: NOW });
    expect(store.readState()).toEqual({
      startedAt: NOW,
      durationMs: 10_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
  });

  it("throws when a timer is already running", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() => initTimer({ store, durationMs: 10_000, now: NOW })).toThrow(
      /already running/i,
    );
  });

  it("throws when a timer is paused", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: NOW - 1_000,
      accumulatedPauseMs: 0,
    });
    expect(() => initTimer({ store, durationMs: 10_000, now: NOW })).toThrow(
      /paused/i,
    );
  });

  it("finalizes an expired timer then starts a new one", () => {
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() =>
      initTimer({ store, durationMs: 10_000, now: NOW }),
    ).not.toThrow();
    expect(store.readState()).toMatchObject({ durationMs: 10_000, startedAt: NOW });
  });
});
