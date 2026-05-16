import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  appendFileSync,
  renameSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface StateRecord {
  startedAt: number;
  durationMs: number;
  pausedAt: number | null;
  accumulatedPauseMs: number;
  project?: string;
}

export type DerivedKind = "idle" | "running" | "paused" | "expired";

export interface DerivedState {
  kind: DerivedKind;
  remainingMs: number;
}

export interface CompletionRecord {
  completedAt: number;
  durationMs: number;
  project?: string;
}

export type CompletionWrite = {
  completedAt: number;
  durationMs: number;
  project: string;
};

export function deriveState({
  file,
  now,
}: {
  file: StateRecord | null;
  now: number;
}): DerivedState {
  if (!file) return { kind: "idle", remainingMs: 0 };

  const nominalEndMs = file.startedAt + file.durationMs + file.accumulatedPauseMs;

  if (file.pausedAt !== null) {
    const remainingMs = Math.max(0, nominalEndMs - file.pausedAt);
    return { kind: "paused", remainingMs };
  }

  const remainingMs = nominalEndMs - now;
  if (remainingMs <= 0) return { kind: "expired", remainingMs: 0 };
  return { kind: "running", remainingMs };
}

export function createStateModule(stateDir: string) {
  const stateFile = join(stateDir, "state.json");
  const completionsFile = join(stateDir, "completions.jsonl");

  function readState(): StateRecord | null {
    try {
      const raw = readFileSync(stateFile, "utf8");
      return JSON.parse(raw) as StateRecord;
    } catch {
      return null;
    }
  }

  function writeState(s: StateRecord): void {
    mkdirSync(stateDir, { recursive: true });
    // Atomic write: write to temp file then rename to avoid partial reads
    const tmp = join(
      tmpdir(),
      `pmdr-state-${randomBytes(6).toString("hex")}.json`,
    );
    writeFileSync(tmp, JSON.stringify(s), "utf8");
    renameSync(tmp, stateFile);
  }

  function clearState(): void {
    try {
      unlinkSync(stateFile);
    } catch {
      // already clear — not an error
    }
  }

  function readCompletions(): CompletionRecord[] {
    try {
      const raw = readFileSync(completionsFile, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CompletionRecord);
    } catch {
      return [];
    }
  }

  function appendCompletion(record: CompletionWrite): void {
    mkdirSync(stateDir, { recursive: true });
    const line = JSON.stringify(record) + "\n";
    appendFileSync(completionsFile, line, "utf8");
  }

  function finalizeIfExpired(now: number): void {
    const file = readState();
    if (!file) return;

    const derived = deriveState({ file, now });
    if (derived.kind !== "expired") return;

    const completedAt =
      file.startedAt + file.durationMs + file.accumulatedPauseMs;
    appendCompletion({ completedAt, durationMs: file.durationMs, project: file.project ?? "(unassigned)" });
    clearState();
  }

  function readToday(now: number): Record<string, CompletionRecord[]> {
    finalizeIfExpired(now);
    const all = readCompletions();
    const nowD = new Date(now);
    const todayEntries = all.filter((c) => {
      const d = new Date(c.completedAt);
      return (
        d.getFullYear() === nowD.getFullYear() &&
        d.getMonth() === nowD.getMonth() &&
        d.getDate() === nowD.getDate()
      );
    });
    const groups: Record<string, CompletionRecord[]> = {};
    for (const entry of todayEntries) {
      const key = entry.project ?? "(unassigned)";
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(entry);
    }
    return groups;
  }

  return { readState, writeState, clearState, readCompletions, appendCompletion, finalizeIfExpired, readToday };
}

const _prod = createStateModule(join(homedir(), ".local", "state", "pmdr"));

export const readState = (): StateRecord | null => _prod.readState();
export const writeState = (s: StateRecord): void => _prod.writeState(s);
export const clearState = (): void => _prod.clearState();
export const readCompletions = (): CompletionRecord[] => _prod.readCompletions();
export const appendCompletion = (r: CompletionWrite): void =>
  _prod.appendCompletion(r);
export const readToday = (now: number): Record<string, CompletionRecord[]> =>
  _prod.readToday(now);
export const finalizeIfExpired = (now: number): void =>
  _prod.finalizeIfExpired(now);
