import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import { pickProject } from "../commands/start.js";

const CANCEL_SYM = Symbol("mock-cancel");
const isCancelFn = (v: unknown): boolean => v === CANCEL_SYM;
const noopCancelFn = (_msg: string): void => {};
const noopTextFn = async (): Promise<string | symbol> => {
  throw new Error("textFn should not be called");
};

describe("pickProject", () => {
  let tmpDir: string;
  let projects: ReturnType<typeof createProjectsModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-picker-test-"));
    projects = createProjectsModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the selected existing project name", async () => {
    projects.upsertProject("my-project");
    const result = await pickProject({
      projects,
      isCancelFn,
      cancelFn: noopCancelFn,
      selectFn: async () => "my-project",
      textFn: noopTextFn,
    });
    expect(result).toBe("my-project");
  });

  it("presents only non-archived projects plus 'new…' option", async () => {
    projects.upsertProject("active-proj");
    projects.upsertProject("archived-proj");
    projects.archiveProject("archived-proj");

    let capturedValues: string[] = [];
    await pickProject({
      projects,
      isCancelFn,
      cancelFn: noopCancelFn,
      selectFn: async (opts) => {
        capturedValues = opts.options.map((o) => o.value);
        return "active-proj";
      },
      textFn: noopTextFn,
    });

    expect(capturedValues).toContain("active-proj");
    expect(capturedValues).not.toContain("archived-proj");
    expect(capturedValues[capturedValues.length - 1]).toBe("__new__");
  });

  it("upserts and returns new project name when 'new…' is selected", async () => {
    const result = await pickProject({
      projects,
      isCancelFn,
      cancelFn: noopCancelFn,
      selectFn: async () => "__new__",
      textFn: async () => "brand-new",
    });
    expect(result).toBe("brand-new");
    expect(projects.findProject("brand-new")).not.toBeNull();
  });

  it("preserves canonical casing from projects store", async () => {
    projects.upsertProject("MyProject");
    const result = await pickProject({
      projects,
      isCancelFn,
      cancelFn: noopCancelFn,
      selectFn: async () => "MyProject",
      textFn: noopTextFn,
    });
    expect(result).toBe("MyProject");
  });

  it("exits with code 1 when select is cancelled", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit(1)");
    }) as never);

    try {
      await expect(
        pickProject({
          projects,
          isCancelFn,
          cancelFn: noopCancelFn,
          selectFn: async () => CANCEL_SYM,
          textFn: noopTextFn,
        }),
      ).rejects.toThrow("exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("exits with code 1 when text input for 'new…' is cancelled", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit(1)");
    }) as never);

    try {
      await expect(
        pickProject({
          projects,
          isCancelFn,
          cancelFn: noopCancelFn,
          selectFn: async () => "__new__",
          textFn: async () => CANCEL_SYM,
        }),
      ).rejects.toThrow("exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("auto-creates the project in the store when a new name is entered", async () => {
    await pickProject({
      projects,
      isCancelFn,
      cancelFn: noopCancelFn,
      selectFn: async () => "__new__",
      textFn: async () => "NewProject",
    });
    const stored = projects.listProjects({ includeArchived: false });
    expect(stored.some((p) => p.name === "NewProject")).toBe(true);
  });
});
