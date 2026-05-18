import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";

describe("createProjectsModule", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-projects-test-"));
    store = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── findProject ───────────────────────────────────────────────────────────

  describe("findProject", () => {
    it("returns null when no projects exist", () => {
      expect(store.findProject("pmdr")).toBeNull();
    });

    it("is case-insensitive", () => {
      store.upsertProject("PMDR");
      expect(store.findProject("pmdr")).not.toBeNull();
      expect(store.findProject("Pmdr")).not.toBeNull();
      expect(store.findProject("PMDR")).not.toBeNull();
    });

    it("trims whitespace before matching", () => {
      store.upsertProject("pmdr");
      expect(store.findProject("  pmdr  ")).not.toBeNull();
    });

    it("returns null for the (unassigned) sentinel", () => {
      expect(store.findProject("(unassigned)")).toBeNull();
    });

    it("rejects (unassigned) regardless of case", () => {
      expect(store.findProject("(UNASSIGNED)")).toBeNull();
      expect(store.findProject("(Unassigned)")).toBeNull();
    });
  });

  // ─── upsertProject ─────────────────────────────────────────────────────────

  describe("upsertProject", () => {
    it("creates a new project and returns the canonical record", () => {
      const record = store.upsertProject("pmdr");
      expect(record.name).toBe("pmdr");
      expect(record.archived).toBe(false);
      expect(typeof record.createdAt).toBe("string");
    });

    it("is idempotent — calling twice with the same name returns the same record", () => {
      const r1 = store.upsertProject("pmdr");
      const r2 = store.upsertProject("pmdr");
      expect(r1.name).toBe(r2.name);
      expect(r1.createdAt).toBe(r2.createdAt);
    });

    it("is idempotent on case variants — preserves first-seen casing", () => {
      const r1 = store.upsertProject("PMDR");
      const r2 = store.upsertProject("pmdr");
      const r3 = store.upsertProject("Pmdr");
      expect(r1.name).toBe("PMDR");
      expect(r2.name).toBe("PMDR");
      expect(r3.name).toBe("PMDR");
    });

    it("trims whitespace from the name", () => {
      const r = store.upsertProject("  pmdr  ");
      expect(r.name).toBe("pmdr");
    });

    it("throws when given the (unassigned) sentinel", () => {
      expect(() => store.upsertProject("(unassigned)")).toThrow();
    });
  });

  // ─── archiveProject / unarchiveProject ─────────────────────────────────────

  describe("archiveProject", () => {
    it("sets archived to true on the project", () => {
      store.upsertProject("pmdr");
      store.archiveProject("pmdr");
      const record = store.findProject("pmdr");
      expect(record?.archived).toBe(true);
    });

    it("is case-insensitive", () => {
      store.upsertProject("pmdr");
      store.archiveProject("PMDR");
      expect(store.findProject("pmdr")?.archived).toBe(true);
    });

    it("is a no-op when the project doesn't exist", () => {
      expect(() => store.archiveProject("nonexistent")).not.toThrow();
    });
  });

  describe("unarchiveProject", () => {
    it("sets archived to false on the project", () => {
      store.upsertProject("pmdr");
      store.archiveProject("pmdr");
      store.unarchiveProject("pmdr");
      expect(store.findProject("pmdr")?.archived).toBe(false);
    });

    it("is a no-op when the project doesn't exist", () => {
      expect(() => store.unarchiveProject("nonexistent")).not.toThrow();
    });
  });

  // ─── listProjects ──────────────────────────────────────────────────────────

  describe("listProjects", () => {
    it("returns empty array when no projects exist", () => {
      expect(store.listProjects({ includeArchived: false })).toEqual([]);
    });

    it("returns only non-archived projects by default", () => {
      store.upsertProject("active");
      store.upsertProject("archived-one");
      store.archiveProject("archived-one");
      const list = store.listProjects({ includeArchived: false });
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe("active");
    });

    it("returns all projects when includeArchived is true", () => {
      store.upsertProject("active");
      store.upsertProject("archived-one");
      store.archiveProject("archived-one");
      const list = store.listProjects({ includeArchived: true });
      expect(list).toHaveLength(2);
    });

    it("preserves creation order", () => {
      store.upsertProject("first");
      store.upsertProject("second");
      store.upsertProject("third");
      const list = store.listProjects({ includeArchived: false });
      expect(list.map((p) => p.name)).toEqual(["first", "second", "third"]);
    });
  });

  // ─── atomic writes ─────────────────────────────────────────────────────────

  describe("atomic writes", () => {
    it("projects.json contains valid JSON after upsert", () => {
      store.upsertProject("pmdr");
      const { readFileSync } = require("node:fs");
      const raw = readFileSync(join(tmpDir, "projects.json"), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("round-trips data correctly via readProjects/writeProjects", () => {
      store.upsertProject("pmdr");
      store.upsertProject("blog");
      const projects = store.readProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.name)).toEqual(["pmdr", "blog"]);
    });

    it("absent file returns empty list", () => {
      const projects = store.readProjects();
      expect(projects).toEqual([]);
    });
  });
});
