import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import { createStateModule } from "../state.js";
import { setProjectLogic } from "../commands/project.js";

const NOW = 1_000_000;

describe("setProjectLogic", () => {
  let tmpDir: string;
  let projects: ReturnType<typeof createProjectsModule>;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-set-test-"));
    projects = createProjectsModule(tmpDir);
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedRunning(project?: string): void {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project,
      phase: "focus",
      completedFocusBlocks: 0,
      id: "test-id",
    });
  }

  function seedPaused(project?: string): void {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: NOW - 1_000,
      accumulatedPauseMs: 0,
      project,
      phase: "focus",
      completedFocusBlocks: 0,
      id: "test-id",
    });
  }

  it("reassigns to an existing project (case-canonicalized)", () => {
    projects.upsertProject("Alpha");
    seedRunning("Beta");
    const result = setProjectLogic(projects, store, { name: "alpha" });
    expect(result.name).toBe("Alpha");
    expect(store.readState()?.project).toBe("Alpha");
  });

  it("auto-creates an unknown project", () => {
    seedRunning("old");
    const result = setProjectLogic(projects, store, { name: "fresh" });
    expect(result.name).toBe("fresh");
    expect(projects.findProject("fresh")?.name).toBe("fresh");
    expect(store.readState()?.project).toBe("fresh");
  });

  it("clears to (unassigned) with --none", () => {
    seedRunning("Alpha");
    const result = setProjectLogic(projects, store, { none: true });
    expect(result.name).toBe("(unassigned)");
    expect(store.readState()?.project).toBe("(unassigned)");
  });

  it("works on a paused session", () => {
    seedPaused("old");
    setProjectLogic(projects, store, { name: "newproj" });
    expect(store.readState()?.project).toBe("newproj");
    expect(store.readState()?.pausedAt).toBe(NOW - 1_000);
  });

  it("preserves other state fields (startedAt, durationMs, id, phase)", () => {
    seedRunning("old");
    setProjectLogic(projects, store, { name: "new" });
    expect(store.readState()).toMatchObject({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
      id: "test-id",
    });
  });

  it("remembers the project for next run when no session is active", () => {
    const result = setProjectLogic(projects, store, { name: "anything" });
    expect(result.name).toBe("anything");
    expect(projects.readLastProject()).toBe("anything");
    expect(store.readState()).toBeNull();
  });

  it("clears the remembered project with --none when idle", () => {
    projects.writeLastProject("Alpha");
    const result = setProjectLogic(projects, store, { none: true });
    expect(result.name).toBe("(unassigned)");
    expect(projects.readLastProject()).toBeNull();
  });

  it("throws when both name and --none are given", () => {
    seedRunning("old");
    expect(() =>
      setProjectLogic(projects, store, { name: "foo", none: true }),
    ).toThrow(/mutually exclusive|both/i);
  });

  it("throws when neither name nor --none is given", () => {
    seedRunning("old");
    expect(() => setProjectLogic(projects, store, {})).toThrow(
      /provide.*name|required/i,
    );
  });

  it("rejects the reserved (unassigned) sentinel as a name", () => {
    seedRunning("old");
    expect(() =>
      setProjectLogic(projects, store, { name: "(unassigned)" }),
    ).toThrow(/reserved/i);
  });

  it("rejects (unassigned) case-insensitively", () => {
    seedRunning("old");
    expect(() =>
      setProjectLogic(projects, store, { name: "(UNASSIGNED)" }),
    ).toThrow(/reserved/i);
  });
});
