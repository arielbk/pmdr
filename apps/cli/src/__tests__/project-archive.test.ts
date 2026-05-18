import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import {
  archiveProjectLogic,
  unarchiveProjectLogic,
} from "../commands/project.js";

describe("archiveProjectLogic", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-archive-test-"));
    store = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets archived to true on the project and returns the updated record", () => {
    store.upsertProject("pmdr");
    const record = archiveProjectLogic(store, "pmdr");
    expect(record.archived).toBe(true);
    expect(record.name).toBe("pmdr");
  });

  it("is case-insensitive", () => {
    store.upsertProject("pmdr");
    const record = archiveProjectLogic(store, "PMDR");
    expect(record.archived).toBe(true);
  });

  it("throws when project does not exist", () => {
    expect(() => archiveProjectLogic(store, "nonexistent")).toThrow(/not found/i);
  });

  it("throws for (unassigned) sentinel", () => {
    expect(() => archiveProjectLogic(store, "(unassigned)")).toThrow(/reserved/i);
  });

  it("is idempotent — archiving an already-archived project succeeds", () => {
    store.upsertProject("pmdr");
    archiveProjectLogic(store, "pmdr");
    expect(() => archiveProjectLogic(store, "pmdr")).not.toThrow();
    expect(store.findProject("pmdr")?.archived).toBe(true);
  });
});

describe("unarchiveProjectLogic", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-unarchive-test-"));
    store = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets archived to false on the project and returns the updated record", () => {
    store.upsertProject("pmdr");
    store.archiveProject("pmdr");
    const record = unarchiveProjectLogic(store, "pmdr");
    expect(record.archived).toBe(false);
    expect(record.name).toBe("pmdr");
  });

  it("is case-insensitive", () => {
    store.upsertProject("pmdr");
    store.archiveProject("pmdr");
    const record = unarchiveProjectLogic(store, "PMDR");
    expect(record.archived).toBe(false);
  });

  it("throws when project does not exist", () => {
    expect(() => unarchiveProjectLogic(store, "nonexistent")).toThrow(/not found/i);
  });

  it("throws for (unassigned) sentinel", () => {
    expect(() => unarchiveProjectLogic(store, "(unassigned)")).toThrow(/reserved/i);
  });

  it("is idempotent — unarchiving an active project succeeds", () => {
    store.upsertProject("pmdr");
    expect(() => unarchiveProjectLogic(store, "pmdr")).not.toThrow();
    expect(store.findProject("pmdr")?.archived).toBe(false);
  });
});
