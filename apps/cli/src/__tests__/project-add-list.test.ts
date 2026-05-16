import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import {
  validateAddName,
  addProjectLogic,
  formatProjectList,
} from "../commands/project.js";

// ─── validateAddName ──────────────────────────────────────────────────────────

describe("validateAddName", () => {
  it("returns trimmed name on valid input", () => {
    expect(validateAddName("pmdr")).toBe("pmdr");
    expect(validateAddName("  side blog  ")).toBe("side blog");
  });

  it("throws on (unassigned) sentinel regardless of case", () => {
    expect(() => validateAddName("(unassigned)")).toThrow(/reserved/i);
    expect(() => validateAddName("(UNASSIGNED)")).toThrow(/reserved/i);
    expect(() => validateAddName("  (Unassigned)  ")).toThrow(/reserved/i);
  });

  it("throws on names longer than 100 characters", () => {
    expect(() => validateAddName("a".repeat(101))).toThrow(/100/);
  });

  it("accepts names exactly 100 characters long", () => {
    expect(() => validateAddName("a".repeat(100))).not.toThrow();
  });

  it("throws on empty name after trim", () => {
    expect(() => validateAddName("")).toThrow();
    expect(() => validateAddName("   ")).toThrow();
  });
});

// ─── addProjectLogic ─────────────────────────────────────────────────────────

describe("addProjectLogic", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-project-add-test-"));
    store = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new project and returns the record", () => {
    const record = addProjectLogic(store, "pmdr");
    expect(record.name).toBe("pmdr");
    expect(record.archived).toBe(false);
  });

  it("throws on duplicate (case-insensitive)", () => {
    store.upsertProject("pmdr");
    expect(() => addProjectLogic(store, "pmdr")).toThrow(/already exists/i);
    expect(() => addProjectLogic(store, "PMDR")).toThrow(/already exists/i);
    expect(() => addProjectLogic(store, "Pmdr")).toThrow(/already exists/i);
  });

  it("preserves the canonical casing of the first insertion", () => {
    const record = addProjectLogic(store, "MyProject");
    expect(record.name).toBe("MyProject");
  });
});

// ─── formatProjectList ────────────────────────────────────────────────────────

describe("formatProjectList", () => {
  it("returns empty-state message when list is empty", () => {
    expect(formatProjectList([], false)).toContain("No projects");
  });

  it("lists each project name on its own line", () => {
    const records = [
      { name: "pmdr", archived: false, createdAt: "2024-01-01T00:00:00.000Z" },
      { name: "blog", archived: false, createdAt: "2024-01-02T00:00:00.000Z" },
    ];
    const out = formatProjectList(records, false);
    const lines = out.split("\n");
    expect(lines).toContain("pmdr");
    expect(lines).toContain("blog");
  });

  it("appends (archived) marker when includeArchived is true", () => {
    const records = [
      { name: "active", archived: false, createdAt: "2024-01-01T00:00:00.000Z" },
      { name: "old", archived: true, createdAt: "2024-01-02T00:00:00.000Z" },
    ];
    const out = formatProjectList(records, true);
    expect(out).toContain("old");
    expect(out).toContain("(archived)");
    expect(out).not.toMatch(/active.*\(archived\)/);
  });

  it("does not append (archived) marker when includeArchived is false", () => {
    const records = [
      { name: "old", archived: true, createdAt: "2024-01-01T00:00:00.000Z" },
    ];
    const out = formatProjectList(records, false);
    expect(out).not.toContain("(archived)");
  });
});
