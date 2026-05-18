import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTimer } from "../commands/start.js";
import { createStateModule } from "../state.js";
import { createProjectsModule } from "../projects.js";

const NOW = 1_000_000;

describe("start-with-project", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  let projects: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-swp-test-"));
    store = createStateModule(tmpDir);
    projects = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores the project name in state", () => {
    initTimer({ store, durationMs: 10_000, now: NOW, project: "pmdr" });
    expect(store.readState()?.project).toBe("pmdr");
  });

  it("eager completion writes log entry with the captured project", () => {
    initTimer({ store, durationMs: 1_000, now: NOW, project: "my-project" });
    store.finalizeIfExpired(NOW + 2_000);

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.project).toBe("my-project");
  });

  it("lazy completion via finalizeIfExpired uses the project from state", () => {
    initTimer({ store, durationMs: 1_000, now: NOW, project: "lazy-proj" });
    // Simulate another command observing the expired state
    store.finalizeIfExpired(NOW + 5_000);

    expect(store.readState()).toBeNull();
    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.project).toBe("lazy-proj");
    expect(entry.durationMs).toBe(1_000);
  });

  it("completion uses a project changed after start", () => {
    initTimer({ store, durationMs: 1_000, now: NOW });
    const active = store.readState()!;
    store.writeState({ ...active, project: "picked-later" });

    store.finalizeIfExpired(NOW + 2_000);

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.project).toBe("picked-later");
  });

  it("state file without project falls back to (unassigned) on finalize", () => {
    // Simulate legacy state (no project field)
    store.writeState({
      startedAt: NOW - 2_000,
      durationMs: 1_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    store.finalizeIfExpired(NOW);

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.project).toBe("(unassigned)");
  });

  it("upsertProject is called — auto-creates a new project in projects.json", () => {
    projects.upsertProject("brand-new");
    initTimer({ store, durationMs: 1_000, now: NOW, project: "brand-new" });
    const ps = projects.readProjects();
    expect(ps.some((p) => p.name === "brand-new")).toBe(true);
  });

  it("preserves canonical casing from first upsert", () => {
    projects.upsertProject("MyProject");
    const canonical = projects.upsertProject("myproject").name;
    expect(canonical).toBe("MyProject");
  });

  it("pause preserves project through spread", () => {
    initTimer({ store, durationMs: 60_000, now: NOW, project: "preserved" });
    const file = store.readState()!;
    store.writeState({ ...file, pausedAt: NOW + 1_000 });
    expect(store.readState()?.project).toBe("preserved");
  });
});
