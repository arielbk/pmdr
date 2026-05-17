import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const UNASSIGNED = "(unassigned)";

export interface ProjectRecord {
  name: string;
  archived: boolean;
  createdAt: string;
}

interface ProjectsFile {
  projects: ProjectRecord[];
}

export function createProjectsModule(stateDir: string) {
  const projectsFile = join(stateDir, "projects.json");

  function readProjects(): ProjectRecord[] {
    try {
      const raw = readFileSync(projectsFile, "utf8");
      const data = JSON.parse(raw) as ProjectsFile;
      return data.projects ?? [];
    } catch {
      return [];
    }
  }

  function writeProjects(projects: ProjectRecord[]): void {
    mkdirSync(stateDir, { recursive: true });
    const tmp = join(
      tmpdir(),
      `pmdr-projects-${randomBytes(6).toString("hex")}.json`,
    );
    const data: ProjectsFile = { projects };
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, projectsFile);
  }

  function isUnassigned(name: string): boolean {
    return name.trim().toLowerCase() === UNASSIGNED.toLowerCase();
  }

  function findProject(name: string): ProjectRecord | null {
    if (isUnassigned(name)) return null;
    const normalized = name.trim().toLowerCase();
    const projects = readProjects();
    return projects.find((p) => p.name.toLowerCase() === normalized) ?? null;
  }

  function upsertProject(name: string): ProjectRecord {
    const trimmed = name.trim();
    if (isUnassigned(trimmed)) {
      throw new Error(`"${UNASSIGNED}" is a reserved sentinel and cannot be used as a project name`);
    }
    const projects = readProjects();
    const normalized = trimmed.toLowerCase();
    const existing = projects.find((p) => p.name.toLowerCase() === normalized);
    if (existing) return existing;
    const record: ProjectRecord = {
      name: trimmed,
      archived: false,
      createdAt: new Date().toISOString(),
    };
    projects.push(record);
    writeProjects(projects);
    return record;
  }

  function archiveProject(name: string): void {
    const normalized = name.trim().toLowerCase();
    const projects = readProjects();
    const idx = projects.findIndex((p) => p.name.toLowerCase() === normalized);
    if (idx === -1) return;
    projects[idx]!.archived = true;
    writeProjects(projects);
  }

  function unarchiveProject(name: string): void {
    const normalized = name.trim().toLowerCase();
    const projects = readProjects();
    const idx = projects.findIndex((p) => p.name.toLowerCase() === normalized);
    if (idx === -1) return;
    projects[idx]!.archived = false;
    writeProjects(projects);
  }

  function listProjects({ includeArchived }: { includeArchived: boolean }): ProjectRecord[] {
    const projects = readProjects();
    if (includeArchived) return projects;
    return projects.filter((p) => !p.archived);
  }

  function renameProject(oldName: string, newName: string): ProjectRecord {
    const oldTrimmed = oldName.trim();
    const newTrimmed = newName.trim();

    if (isUnassigned(oldTrimmed)) {
      throw new Error(`"${UNASSIGNED}" is a reserved sentinel and cannot be renamed`);
    }
    if (isUnassigned(newTrimmed)) {
      throw new Error(`"${UNASSIGNED}" is a reserved sentinel and cannot be used as a project name`);
    }

    const projects = readProjects();
    const oldNorm = oldTrimmed.toLowerCase();
    const newNorm = newTrimmed.toLowerCase();

    const oldIdx = projects.findIndex((p) => p.name.toLowerCase() === oldNorm);
    if (oldIdx === -1) {
      throw new Error(`Project "${oldTrimmed}" not found`);
    }

    const collision = projects.find((p, i) => i !== oldIdx && p.name.toLowerCase() === newNorm);
    if (collision) {
      throw new Error(`Project "${collision.name}" already exists`);
    }

    projects[oldIdx]!.name = newTrimmed;
    writeProjects(projects);
    return projects[oldIdx]!;
  }

  return { readProjects, writeProjects, findProject, upsertProject, archiveProject, unarchiveProject, listProjects, renameProject };
}

const _prod = createProjectsModule(join(homedir(), ".local", "state", "pmdr"));

export const readProjects = (): ProjectRecord[] => _prod.readProjects();
export const writeProjects = (p: ProjectRecord[]): void => _prod.writeProjects(p);
export const findProject = (name: string): ProjectRecord | null => _prod.findProject(name);
export const upsertProject = (name: string): ProjectRecord => _prod.upsertProject(name);
export const archiveProject = (name: string): void => _prod.archiveProject(name);
export const unarchiveProject = (name: string): void => _prod.unarchiveProject(name);
export const listProjects = (opts: { includeArchived: boolean }): ProjectRecord[] => _prod.listProjects(opts);
export const renameProject = (oldName: string, newName: string): ProjectRecord => _prod.renameProject(oldName, newName);
