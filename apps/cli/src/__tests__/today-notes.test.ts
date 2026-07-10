import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, type NoteRecord } from "../state.js";
import {
  readTodayNotes,
  formatTodayGrouped,
  buildTodayJson,
  type TodayGroupedResult,
} from "../commands/today.js";

const NOW = new Date("2024-01-15T12:00:00").getTime();

function note(partial: Partial<NoteRecord> & { at: number; text: string }): NoteRecord {
  return {
    sessionId: "",
    project: "",
    phase: "",
    ...partial,
  };
}

describe("readTodayNotes", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-tn-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns [] when no notes file exists", () => {
    expect(readTodayNotes({ store, now: NOW })).toEqual([]);
  });

  it("includes today's notes and excludes other days' (injected now)", () => {
    const todayAt = new Date("2024-01-15T09:00:00").getTime();
    const yestAt = new Date("2024-01-14T23:00:00").getTime();
    const tomAt = new Date("2024-01-16T01:00:00").getTime();
    store.appendNote(note({ at: yestAt, text: "yesterday" }));
    store.appendNote(note({ at: todayAt, text: "today" }));
    store.appendNote(note({ at: tomAt, text: "tomorrow" }));

    const result = readTodayNotes({ store, now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("today");
  });

  it("returns today's notes in time order", () => {
    const early = new Date("2024-01-15T09:00:00").getTime();
    const mid = new Date("2024-01-15T11:05:00").getTime();
    const late = new Date("2024-01-15T15:30:00").getTime();
    store.appendNote(note({ at: late, text: "late" }));
    store.appendNote(note({ at: early, text: "early" }));
    store.appendNote(note({ at: mid, text: "mid" }));

    const result = readTodayNotes({ store, now: NOW });
    expect(result.map((n) => n.text)).toEqual(["early", "mid", "late"]);
  });
});

describe("formatTodayGrouped with notes", () => {
  const result: TodayGroupedResult = {
    groups: [
      {
        project: "pmdr",
        pomodoros: 1,
        totalMs: 1500_000,
        entries: [
          { completedAt: new Date("2024-01-15T09:00:00").getTime(), durationMs: 1500_000 },
        ],
      },
    ],
    total: { pomodoros: 1, totalMs: 1500_000 },
  };

  it("is byte-identical to the no-notes output when there are no notes", () => {
    const withEmpty = formatTodayGrouped(result, []);
    const withoutArg = formatTodayGrouped(result);
    expect(withEmpty).toBe(withoutArg);
    expect(withEmpty).not.toContain("Notes:");
  });

  it("renders a Notes: section in time order after the groups", () => {
    const notes: NoteRecord[] = [
      note({ at: new Date("2024-01-15T09:05:00").getTime(), text: "fixed the auth race" }),
      note({ at: new Date("2024-01-15T11:30:00").getTime(), text: "second thought" }),
    ];
    const out = formatTodayGrouped(result, notes);
    const lines = out.split("\n");
    const notesIdx = lines.indexOf("Notes:");
    const totalIdx = lines.findIndex((l) => l.startsWith("Total:"));
    expect(notesIdx).toBeGreaterThan(totalIdx);
    expect(lines[notesIdx + 1]).toBe("  9:05  fixed the auth race");
    expect(lines[notesIdx + 2]).toBe("  11:30  second thought");
  });
});

describe("buildTodayJson", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-tnj-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes a notes array alongside groups and total", () => {
    store.appendCompletion({
      completedAt: new Date("2024-01-15T09:00:00").getTime(),
      durationMs: 1500_000,
      project: "pmdr",
    });
    store.appendNote(note({ at: new Date("2024-01-15T09:05:00").getTime(), text: "a note" }));

    const json = JSON.parse(JSON.stringify(buildTodayJson({ store, now: NOW })));
    expect(Array.isArray(json.notes)).toBe(true);
    expect(json.notes).toHaveLength(1);
    expect(json.notes[0].text).toBe("a note");
    expect(json.groups).toBeDefined();
    expect(json.total).toBeDefined();
  });

  it("includes an empty notes array on a note-free day", () => {
    const json = buildTodayJson({ store, now: NOW });
    expect(json.notes).toEqual([]);
  });
});
