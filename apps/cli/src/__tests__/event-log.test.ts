import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTimer } from "../commands/start.js";
import { pauseTimer } from "../commands/pause.js";
import { resumeTimer } from "../commands/resume.js";
import { stopTimer } from "../commands/stop.js";
import { createStateModule } from "../state.js";

type EventRow = {
  type: "start" | "stop" | "pause" | "resume";
  at: number;
  id: string;
  project?: string;
};

function readEvents(dir: string): EventRow[] {
  const file = join(dir, "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EventRow);
}

describe("event-log emission", () => {
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

  it("drive start → pause → resume → stop, all four rows share one id and appear in order", () => {
    initTimer({
      store,
      durationMs: 60_000,
      now: NOW,
      project: "p1",
      id: "fixed-id",
    });
    pauseTimer({ store, now: NOW + 1_000 });
    resumeTimer({ store, now: NOW + 2_000 });
    stopTimer({ store, now: NOW + 3_000 });

    const events = readEvents(tmpDir);
    expect(events.map((e) => e.type)).toEqual([
      "start",
      "pause",
      "resume",
      "stop",
    ]);
    expect(new Set(events.map((e) => e.id))).toEqual(new Set(["fixed-id"]));
    expect(events.map((e) => e.at)).toEqual([
      NOW,
      NOW + 1_000,
      NOW + 2_000,
      NOW + 3_000,
    ]);
    expect(events[0]!.project).toBe("p1");
  });

  it("start → expire writes a completion but no stop event", () => {
    initTimer({
      store,
      durationMs: 10_000,
      now: NOW,
      project: "p1",
      id: "fixed-id",
    });
    store.advancePhaseIfExpired(NOW + 11_000);

    const events = readEvents(tmpDir);
    expect(events.map((e) => e.type)).toEqual(["start"]);

    const completions = readFileSync(
      join(tmpDir, "completions.jsonl"),
      "utf8",
    ).trim();
    expect(completions.length).toBeGreaterThan(0);
  });

  it("stopTimer with no active timer does not write a stop event", () => {
    stopTimer({ store, now: NOW });
    expect(readEvents(tmpDir)).toEqual([]);
  });
});
