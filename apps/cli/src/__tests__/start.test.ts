import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDuration } from "../parse-duration.js";
import { initTimer, resolveStartProject } from "../commands/start.js";
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
    initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" });
    expect(store.readState()).toEqual({
      startedAt: NOW,
      durationMs: 10_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "test-proj",
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  it("defaults to (unassigned) when no project is provided", () => {
    initTimer({ store, durationMs: 10_000, now: NOW });
    expect(store.readState()).toEqual({
      startedAt: NOW,
      durationMs: 10_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "(unassigned)",
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  it("throws when a timer is already running", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() => initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" })).toThrow(
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
    expect(() => initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" })).toThrow(
      /paused/i,
    );
  });

  it("advances a fully expired session (focus+break) to idle, then starts a new timer", () => {
    // startedAt far back enough that both the focus AND the 5-min break have expired
    // focus: expires at NOW-400_000+60_000 = NOW-340_000
    // break: starts at NOW-340_000, lasts 300_000ms → expires at NOW-40_000
    store.writeState({
      startedAt: NOW - 400_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() =>
      initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" }),
    ).not.toThrow();
    expect(store.readState()).toMatchObject({ durationMs: 10_000, startedAt: NOW, project: "test-proj", phase: "focus", completedFocusBlocks: 0 });
  });

  it("throws when break is running after focus expired", () => {
    // focus expired 10s ago; 5-min break just started → break is still running
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() =>
      initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" }),
    ).toThrow(/already running/i);
  });
});

describe("resolveStartProject", () => {
  it("returns (unassigned) without touching projects when no project is provided", () => {
    const projects = {
      upsertProject: () => {
        throw new Error("upsertProject should not be called");
      },
    };

    expect(resolveStartProject(undefined, projects)).toBe("(unassigned)");
  });

  it("canonicalizes an explicit project through the project store", () => {
    const projects = {
      upsertProject: (name: string) => ({
        name: name.toUpperCase(),
        archived: false,
        createdAt: "2024-01-15T12:00:00.000Z",
      }),
    };

    expect(resolveStartProject("pmdr", projects)).toBe("PMDR");
  });
});
