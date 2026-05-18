import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTimer } from "../commands/start.js";
import { createStateModule } from "../state.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("pomodoro-id", () => {
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

  it("writes a uuid-shaped id at start", () => {
    initTimer({ store, durationMs: 10_000, now: NOW, project: "p1" });
    const state = store.readState()!;
    expect(state.id).toMatch(UUID_RE);
  });

  it("each new timer gets a fresh id", () => {
    initTimer({ store, durationMs: 10_000, now: NOW, project: "p1" });
    const firstId = store.readState()!.id!;
    store.clearState();
    initTimer({ store, durationMs: 10_000, now: NOW + 1_000, project: "p1" });
    const secondId = store.readState()!.id!;
    expect(secondId).toMatch(UUID_RE);
    expect(secondId).not.toBe(firstId);
  });

  it("completion row carries the same id as the source state", () => {
    initTimer({ store, durationMs: 10_000, now: NOW, project: "p1" });
    const id = store.readState()!.id!;

    store.advancePhaseIfExpired(NOW + 11_000);

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const row = JSON.parse(raw.trim());
    expect(row.id).toBe(id);
  });

  it("reads legacy state.json without id without throwing", () => {
    writeFileSync(
      join(tmpDir, "state.json"),
      JSON.stringify({
        startedAt: NOW,
        durationMs: 10_000,
        pausedAt: null,
        accumulatedPauseMs: 0,
        project: "p1",
        phase: "focus",
        completedFocusBlocks: 0,
      }),
      "utf8",
    );
    expect(() => store.readState()).not.toThrow();
    const state = store.readState();
    expect(state).not.toBeNull();
    expect(state!.id).toBeUndefined();
  });

  it("id survives phase transition into break", () => {
    initTimer({ store, durationMs: 10_000, now: NOW, project: "p1" });
    const id = store.readState()!.id!;

    store.advancePhaseIfExpired(NOW + 11_000);

    const next = store.readState()!;
    expect(next.phase).toBe("break");
    expect(next.id).toBe(id);
  });
});
