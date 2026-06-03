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
  phase?: "focus" | "break";
  completedFocusBlocks?: number;
  id?: string;
}

const DEFAULT_SHORT_BREAK_MS = 5 * 60 * 1000;
const DEFAULT_LONG_BREAK_MS = 15 * 60 * 1000;
const DEFAULT_LONG_BREAK_AFTER = 4;

export const DEFAULT_FOCUS_GOAL = 8;

function computeBreakDurationMs(completedFocusBlocks: number): number {
  return completedFocusBlocks % DEFAULT_LONG_BREAK_AFTER === 0
    ? DEFAULT_LONG_BREAK_MS
    : DEFAULT_SHORT_BREAK_MS;
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
  id?: string;
}

export type CompletionWrite = {
  completedAt: number;
  durationMs: number;
  project: string;
  id?: string;
};

export type EventType = "start" | "stop" | "pause" | "resume";

export interface EventRecord {
  type: EventType;
  at: number;
  id: string;
  project?: string;
}

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
  const eventsFile = join(stateDir, "events.jsonl");

  function appendEvent(event: EventRecord): void {
    mkdirSync(stateDir, { recursive: true });
    const row: EventRecord = {
      type: event.type,
      at: event.at,
      id: event.id,
      ...(event.project !== undefined ? { project: event.project } : {}),
    };
    appendFileSync(eventsFile, JSON.stringify(row) + "\n", "utf8");
  }

  function readEvents(): EventRecord[] {
    try {
      const raw = readFileSync(eventsFile, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventRecord);
    } catch {
      return [];
    }
  }

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
    appendCompletion({
      completedAt,
      durationMs: file.durationMs,
      project: file.project ?? "(unassigned)",
      ...(file.id ? { id: file.id } : {}),
    });
    clearState();
  }

  function advancePhaseIfExpired(now: number): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const file = readState();
      if (!file) return;

      const derived = deriveState({ file, now });
      if (derived.kind !== "expired") return;

      const completedAt = file.startedAt + file.durationMs + file.accumulatedPauseMs;
      const phase = file.phase ?? "focus";
      const completedFocusBlocks = file.completedFocusBlocks ?? 0;

      if (phase === "focus") {
        appendCompletion({
          completedAt,
          durationMs: file.durationMs,
          project: file.project ?? "(unassigned)",
          ...(file.id ? { id: file.id } : {}),
        });
        const newCompletedFocusBlocks = completedFocusBlocks + 1;
        // Break is born paused at the focus completion moment: it waits at full
        // duration until the user explicitly starts (resumes) it. A paused phase
        // never derives as "expired", so the loop below terminates without
        // advancing the pending break.
        writeState({
          startedAt: completedAt,
          durationMs: computeBreakDurationMs(newCompletedFocusBlocks),
          pausedAt: completedAt,
          accumulatedPauseMs: 0,
          project: file.project,
          phase: "break",
          completedFocusBlocks: newCompletedFocusBlocks,
          ...(file.id ? { id: file.id } : {}),
        });
        // loop re-reads: the pending break derives as "paused", so we return
      } else {
        // break expired → return to idle, no completion logged
        clearState();
        return;
      }
    }
  }

  function rewriteCompletionProject(oldName: string, newName: string): void {
    const completions = readCompletions();
    const oldNorm = oldName.trim().toLowerCase();
    const newTrimmed = newName.trim();
    const updated = completions.map((c) => {
      if ((c.project ?? "").toLowerCase() === oldNorm) {
        return { ...c, project: newTrimmed };
      }
      return c;
    });
    mkdirSync(stateDir, { recursive: true });
    const tmp = join(
      tmpdir(),
      `pmdr-completions-${randomBytes(6).toString("hex")}.jsonl`,
    );
    const content = updated.map((c) => JSON.stringify(c)).join("\n");
    writeFileSync(tmp, content.length > 0 ? content + "\n" : "", "utf8");
    renameSync(tmp, completionsFile);
  }

  function readToday(now: number): Record<string, CompletionRecord[]> {
    advancePhaseIfExpired(now);
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

  return {
    readState,
    writeState,
    clearState,
    readCompletions,
    appendCompletion,
    finalizeIfExpired,
    advancePhaseIfExpired,
    readToday,
    rewriteCompletionProject,
    appendEvent,
    readEvents,
  };
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
export const advancePhaseIfExpired = (now: number): void =>
  _prod.advancePhaseIfExpired(now);
export const rewriteCompletionProject = (oldName: string, newName: string): void =>
  _prod.rewriteCompletionProject(oldName, newName);
export const appendEvent = (e: EventRecord): void => _prod.appendEvent(e);
export const readEvents = (): EventRecord[] => _prod.readEvents();
