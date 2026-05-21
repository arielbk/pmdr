import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import { resolveStartProject } from "../commands/start.js";

describe("last-project memory", () => {
  let tmpDir: string;
  let projects: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-last-test-"));
    projects = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("read returns null when no last project has been written", () => {
    expect(projects.readLastProject()).toBeNull();
  });

  it("round-trips a project name", () => {
    projects.writeLastProject("alpha");
    expect(projects.readLastProject()).toBe("alpha");
  });

  it("ignores writes of (unassigned) and empty names", () => {
    projects.writeLastProject("(unassigned)");
    expect(projects.readLastProject()).toBeNull();
    projects.writeLastProject("   ");
    expect(projects.readLastProject()).toBeNull();
  });

  it("clears the last project when passed null", () => {
    projects.writeLastProject("alpha");
    projects.writeLastProject(null);
    expect(projects.readLastProject()).toBeNull();
  });

  it("resolveLastActiveProject returns the name only when project exists and is not archived", () => {
    projects.upsertProject("alpha");
    projects.writeLastProject("alpha");
    expect(projects.resolveLastActiveProject()).toBe("alpha");

    projects.archiveProject("alpha");
    expect(projects.resolveLastActiveProject()).toBeNull();

    projects.unarchiveProject("alpha");
    expect(projects.resolveLastActiveProject()).toBe("alpha");
  });

  it("resolveLastActiveProject returns null when remembered project no longer exists", () => {
    projects.upsertProject("alpha");
    projects.writeLastProject("alpha");
    // Simulate the project being removed by writing a fresh empty list.
    projects.writeProjects([]);
    expect(projects.resolveLastActiveProject()).toBeNull();
  });

  it("resolveStartProject falls back to last active project when no arg is given", () => {
    projects.upsertProject("alpha");
    projects.writeLastProject("alpha");
    expect(resolveStartProject(undefined, projects, projects)).toBe("alpha");
  });

  it("resolveStartProject falls back to (unassigned) when last project is archived", () => {
    projects.upsertProject("alpha");
    projects.writeLastProject("alpha");
    projects.archiveProject("alpha");
    expect(resolveStartProject(undefined, projects, projects)).toBe(
      "(unassigned)",
    );
  });

  it("resolveStartProject prefers explicit --project arg over last memory", () => {
    projects.upsertProject("alpha");
    projects.writeLastProject("alpha");
    expect(resolveStartProject("beta", projects, projects)).toBe("beta");
  });
});
