import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import { createStateModule } from "../state.js";
import { renameProjectLogic } from "../commands/project.js";

// ─── renameProject (projects module) ─────────────────────────────────────────

describe("renameProject", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-rename-test-"));
    store = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renames project and preserves canonical casing of new name", () => {
    store.upsertProject("OldProject");
    const record = store.renameProject("OldProject", "NewProject");
    expect(record.name).toBe("NewProject");
    const found = store.findProject("newproject");
    expect(found?.name).toBe("NewProject");
    expect(store.findProject("oldproject")).toBeNull();
  });

  it("is case-insensitive on the old name", () => {
    store.upsertProject("pmdr");
    expect(() => store.renameProject("PMDR", "pmdr-v2")).not.toThrow();
    expect(store.findProject("pmdr-v2")).not.toBeNull();
  });

  it("throws if old project does not exist", () => {
    expect(() => store.renameProject("nonexistent", "new")).toThrow(/not found/i);
  });

  it("throws if new name already exists as a distinct project (case-insensitive)", () => {
    store.upsertProject("alpha");
    store.upsertProject("beta");
    expect(() => store.renameProject("alpha", "beta")).toThrow(/already exists/i);
    expect(() => store.renameProject("alpha", "BETA")).toThrow(/already exists/i);
  });

  it("rejects (unassigned) as old name", () => {
    expect(() => store.renameProject("(unassigned)", "new")).toThrow(/reserved/i);
  });

  it("rejects (unassigned) as new name", () => {
    store.upsertProject("pmdr");
    expect(() => store.renameProject("pmdr", "(unassigned)")).toThrow(/reserved/i);
  });

  it("preserves other project fields (archived, createdAt) after rename", () => {
    store.upsertProject("alpha");
    store.archiveProject("alpha");
    const record = store.renameProject("alpha", "alpha-v2");
    expect(record.archived).toBe(true);
    expect(record.createdAt).toBeTruthy();
  });
});

// ─── rewriteCompletionProject (state module) ──────────────────────────────────

describe("rewriteCompletionProject", () => {
  let tmpDir: string;
  let stateStore: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-rewrite-test-"));
    stateStore = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rewrites all matching log entries to the new canonical name", () => {
    stateStore.appendCompletion({ completedAt: 1000, durationMs: 1500000, project: "OldName" });
    stateStore.appendCompletion({ completedAt: 2000, durationMs: 1500000, project: "OldName" });
    stateStore.appendCompletion({ completedAt: 3000, durationMs: 1500000, project: "other" });

    stateStore.rewriteCompletionProject("OldName", "NewName");

    const completions = stateStore.readCompletions();
    const renamed = completions.filter(c => c.project === "NewName");
    const untouched = completions.filter(c => c.project === "other");
    const old = completions.filter(c => c.project === "OldName");
    expect(renamed).toHaveLength(2);
    expect(untouched).toHaveLength(1);
    expect(old).toHaveLength(0);
  });

  it("is case-insensitive when matching old name", () => {
    stateStore.appendCompletion({ completedAt: 1000, durationMs: 1500000, project: "pmdr" });
    stateStore.rewriteCompletionProject("PMDR", "pmdr-v2");
    const completions = stateStore.readCompletions();
    expect(completions[0]?.project).toBe("pmdr-v2");
  });

  it("is a no-op when no log entries reference old name", () => {
    stateStore.appendCompletion({ completedAt: 1000, durationMs: 1500000, project: "other" });
    stateStore.rewriteCompletionProject("nonexistent", "whatever");
    const completions = stateStore.readCompletions();
    expect(completions[0]?.project).toBe("other");
  });

  it("works when the log is empty", () => {
    expect(() => stateStore.rewriteCompletionProject("old", "new")).not.toThrow();
  });
});

// ─── renameProjectLogic (integration) ────────────────────────────────────────

describe("renameProjectLogic", () => {
  let tmpDir: string;
  let projectsStore: ReturnType<typeof createProjectsModule>;
  let stateStore: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-rename-logic-test-"));
    projectsStore = createProjectsModule(tmpDir);
    stateStore = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates projects.json and rewrites log entries atomically", () => {
    projectsStore.upsertProject("alpha");
    stateStore.appendCompletion({ completedAt: 1000, durationMs: 1500000, project: "alpha" });
    stateStore.appendCompletion({ completedAt: 2000, durationMs: 1500000, project: "alpha" });

    renameProjectLogic(projectsStore, stateStore, "alpha", "Alpha-v2");

    const found = projectsStore.findProject("alpha-v2");
    expect(found?.name).toBe("Alpha-v2");
    expect(projectsStore.findProject("alpha")).toBeNull();

    const completions = stateStore.readCompletions();
    expect(completions.every(c => c.project === "Alpha-v2")).toBe(true);
  });

  it("propagates errors from renameProject without touching the log", () => {
    projectsStore.upsertProject("alpha");
    stateStore.appendCompletion({ completedAt: 1000, durationMs: 1500000, project: "alpha" });

    expect(() => renameProjectLogic(projectsStore, stateStore, "nonexistent", "beta")).toThrow();

    const completions = stateStore.readCompletions();
    expect(completions[0]?.project).toBe("alpha");
  });
});
