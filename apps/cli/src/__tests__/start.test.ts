import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDuration } from "../parse-duration.js";
import { initTimer, resolveStartProject } from "../commands/start.js";
import { createStateModule } from "../state.js";
import { createProjectsModule } from "../projects.js";

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
    initTimer({
      store,
      durationMs: 10_000,
      now: NOW,
      project: "test-proj",
      id: "fixed-id-1",
    });
    expect(store.readState()).toEqual({
      startedAt: NOW,
      durationMs: 10_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "test-proj",
      phase: "focus",
      completedFocusBlocks: 0,
      id: "fixed-id-1",
    });
  });

  it("defaults to (unassigned) when no project is provided", () => {
    initTimer({ store, durationMs: 10_000, now: NOW, id: "fixed-id-2" });
    expect(store.readState()).toEqual({
      startedAt: NOW,
      durationMs: 10_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "(unassigned)",
      phase: "focus",
      completedFocusBlocks: 0,
      id: "fixed-id-2",
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

  it("lands a long-expired focus in a pending break, so a plain start refuses", () => {
    // startedAt far back enough that the focus expired long ago. The break is
    // now born paused at the focus completion moment and never auto-expires, so
    // the user is left in a pending break. A plain start must refuse — skipping
    // the break requires stop or start --force (covered in the cli-flows slice).
    store.writeState({
      startedAt: NOW - 400_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() =>
      initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" }),
    ).toThrow(/paused/i);
    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.pausedAt).toBe(NOW - 340_000); // born paused at focus completion
  });

  it("refuses to start while a break is pending after focus expired", () => {
    // focus expired 10s ago → break is born paused (pending). start must still
    // refuse, now reporting the timer as paused rather than running.
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() =>
      initTimer({ store, durationMs: 10_000, now: NOW, project: "test-proj" }),
    ).toThrow(/paused/i);
  });
});

describe("start without --project (non-TTY path)", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  let projects: ReturnType<typeof createProjectsModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-noproj-test-"));
    store = createStateModule(tmpDir);
    projects = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves missing --project to (unassigned) and writes state without touching projects.json", () => {
    const project = resolveStartProject(undefined, projects);
    initTimer({ store, durationMs: 10_000, now: NOW, project, id: "no-proj-1" });

    expect(store.readState()?.project).toBe("(unassigned)");
    expect(projects.readProjects()).toEqual([]);
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
