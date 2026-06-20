import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, type NoteRecord } from "../state.js";
import { addNote } from "../commands/note.js";

function readNotes(dir: string): NoteRecord[] {
  const file = join(dir, "notes.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NoteRecord);
}

describe("addNote", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends one well-formed JSONL record with text and timestamp", () => {
    const wrote = addNote({ store, text: "check the X bug", now: NOW });

    expect(wrote).toBe(true);
    const notes = readNotes(tmpDir);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe("check the X bug");
    expect(notes[0]!.at).toBe(NOW);
  });

  it("stamps the live session id / project / phase when a timer is running", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "p1",
      phase: "focus",
      id: "session-id",
    });

    addNote({ store, text: "during focus", now: NOW });

    const note = readNotes(tmpDir)[0]!;
    expect(note.sessionId).toBe("session-id");
    expect(note.project).toBe("p1");
    expect(note.phase).toBe("focus");
  });

  it("leaves session fields empty when idle (no active timer)", () => {
    addNote({ store, text: "idle thought", now: NOW });

    const note = readNotes(tmpDir)[0]!;
    expect(note.sessionId).toBe("");
    expect(note.project).toBe("");
    expect(note.phase).toBe("");
  });

  it("is a no-op for whitespace-only text, writing zero lines", () => {
    expect(addNote({ store, text: "   ", now: NOW })).toBe(false);
    expect(addNote({ store, text: "", now: NOW })).toBe(false);
    expect(readNotes(tmpDir)).toHaveLength(0);
  });
});
