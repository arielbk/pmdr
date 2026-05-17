import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProjectsModule } from "../projects.js";
import type { ProjectRecord } from "../projects.js";
import { createStateModule } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

// ─── helpers (exported for testing) ──────────────────────────────────────────

export function validateAddName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Project name cannot be empty");
  }
  if (trimmed.toLowerCase() === "(unassigned)") {
    throw new Error('"(unassigned)" is a reserved sentinel and cannot be used as a project name');
  }
  if (trimmed.length > 100) {
    throw new Error("Project name must be 100 characters or fewer");
  }
  return trimmed;
}

export function addProjectLogic(
  store: ReturnType<typeof createProjectsModule>,
  name: string,
): ProjectRecord {
  const existing = store.findProject(name);
  if (existing) {
    throw new Error(`Project "${existing.name}" already exists`);
  }
  return store.upsertProject(name);
}

export function formatProjectList(
  records: ProjectRecord[],
  includeArchived: boolean,
): string {
  if (records.length === 0) return "No projects found";
  return records
    .map((r) => {
      const marker = includeArchived && r.archived ? "  (archived)" : "";
      return `${r.name}${marker}`;
    })
    .join("\n");
}

export function renameProjectLogic(
  projectsStore: ReturnType<typeof createProjectsModule>,
  stateStore: ReturnType<typeof createStateModule>,
  oldName: string,
  newName: string,
): ProjectRecord {
  const record = projectsStore.renameProject(oldName, newName);
  stateStore.rewriteCompletionProject(oldName, newName);
  return record;
}

export function archiveProjectLogic(
  store: ReturnType<typeof createProjectsModule>,
  name: string,
): ProjectRecord {
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === "(unassigned)") {
    throw new Error('"(unassigned)" is a reserved sentinel and cannot be archived');
  }
  const existing = store.findProject(trimmed);
  if (!existing) {
    throw new Error(`Project "${trimmed}" not found`);
  }
  store.archiveProject(trimmed);
  return { ...existing, archived: true };
}

export function unarchiveProjectLogic(
  store: ReturnType<typeof createProjectsModule>,
  name: string,
): ProjectRecord {
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === "(unassigned)") {
    throw new Error('"(unassigned)" is a reserved sentinel and cannot be unarchived');
  }
  const existing = store.findProject(trimmed);
  if (!existing) {
    throw new Error(`Project "${trimmed}" not found`);
  }
  store.unarchiveProject(trimmed);
  return { ...existing, archived: false };
}

// ─── sub-commands ─────────────────────────────────────────────────────────────

const addCmd = defineCommand({
  meta: { description: "Add a new project" },
  args: {
    name: { type: "positional", required: true, description: "Project name" },
  },
  run({ args }) {
    let name: string;
    try {
      name = validateAddName(args.name as string);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const store = createProjectsModule(STATE_DIR);
    let record: ProjectRecord;
    try {
      record = addProjectLogic(store, name);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    console.log(`Created project "${record.name}"`);
  },
});

const listCmd = defineCommand({
  meta: { description: "List projects" },
  args: {
    "include-archived": {
      type: "boolean",
      description: "Include archived projects",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run({ args }) {
    const store = createProjectsModule(STATE_DIR);
    const includeArchived = (args["include-archived"] as boolean | undefined) ?? false;
    const records = store.listProjects({ includeArchived });

    if (args.json) {
      console.log(JSON.stringify({ projects: records }));
    } else {
      console.log(formatProjectList(records, includeArchived));
    }
  },
});

const renameCmd = defineCommand({
  meta: { description: "Rename a project" },
  args: {
    old: { type: "positional", required: true, description: "Current project name" },
    new: { type: "positional", required: true, description: "New project name" },
  },
  run({ args }) {
    const projectsStore = createProjectsModule(STATE_DIR);
    const stateStore = createStateModule(STATE_DIR);
    let record: ProjectRecord;
    try {
      record = renameProjectLogic(projectsStore, stateStore, args.old as string, args.new as string);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    console.log(`Renamed project to "${record.name}"`);
  },
});

const archiveCmd = defineCommand({
  meta: { description: "Archive a project" },
  args: {
    name: { type: "positional", required: true, description: "Project name" },
  },
  run({ args }) {
    const store = createProjectsModule(STATE_DIR);
    let record: ProjectRecord;
    try {
      record = archiveProjectLogic(store, args.name as string);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    console.log(`Archived project "${record.name}"`);
  },
});

const unarchiveCmd = defineCommand({
  meta: { description: "Unarchive a project" },
  args: {
    name: { type: "positional", required: true, description: "Project name" },
  },
  run({ args }) {
    const store = createProjectsModule(STATE_DIR);
    let record: ProjectRecord;
    try {
      record = unarchiveProjectLogic(store, args.name as string);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    console.log(`Unarchived project "${record.name}"`);
  },
});

// ─── project command ──────────────────────────────────────────────────────────

export default defineCommand({
  meta: { description: "Manage projects" },
  subCommands: {
    add: addCmd,
    list: listCmd,
    rename: renameCmd,
    archive: archiveCmd,
    unarchive: unarchiveCmd,
  },
});
