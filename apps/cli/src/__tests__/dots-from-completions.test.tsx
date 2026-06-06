import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, cleanup } from "ink-testing-library";
import CountdownView from "../tui/CountdownView.js";
import App from "../tui/App.js";
import { derivePhaseState } from "../tui/phase-state-machine.js";
import { createStateModule } from "../state.js";
import { DEFAULT_CONFIG } from "../config.js";

afterEach(() => {
  cleanup();
});

describe("CountdownView — dot row", () => {
  it("does not show the x/8 fraction next to the dots", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={3}
        paused={false}
      />,
    );
    expect(lastFrame()).not.toMatch(/\/\s*8/);
  });

  it("renders N filled dots when completedFocusBlocks=N (N≤8)", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={3}
        paused={false}
      />,
    );
    const filled = (lastFrame() ?? "").match(/●/g) ?? [];
    expect(filled.length).toBe(3);
  });

  it("caps filled dots at 8 even when more focus blocks are completed", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={12}
        paused={false}
      />,
    );
    const filled = (lastFrame() ?? "").match(/●/g) ?? [];
    expect(filled.length).toBe(8);
  });

  it("renders dailyGoal=6 total dots (3 filled, 3 empty)", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={3}
        paused={false}
        dailyGoal={6}
        longBreakEvery={3}
      />,
    );
    const filled = (lastFrame() ?? "").match(/●/g) ?? [];
    const empty = (lastFrame() ?? "").match(/○/g) ?? [];
    expect(filled.length).toBe(3);
    expect(empty.length).toBe(3);
  });

  it("inserts an extra gap every longBreakEvery dots (goal=8, longBreakEvery=4)", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={0}
        paused={false}
        dailyGoal={8}
        longBreakEvery={4}
      />,
    );
    // The gap between the two groups of 4 is two spaces, but within each group only one space.
    // Match the pattern: 4 dots separated by single spaces, then double-space, then 4 dots.
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/○ ○ ○ ○  ○ ○ ○ ○/);
  });

  it("caps filled dots at dailyGoal even when completedFocusBlocks exceeds it", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={12}
        paused={false}
        dailyGoal={8}
        longBreakEvery={4}
      />,
    );
    const filled = (lastFrame() ?? "").match(/●/g) ?? [];
    const empty = (lastFrame() ?? "").match(/○/g) ?? [];
    expect(filled.length).toBe(8);
    expect(empty.length).toBe(0);
  });
});

describe("App — config wires dailyGoal into dot row", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-app-dots-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    cleanup();
  });

  it("renders only dailyGoal dots when config sets dailyGoal=6", () => {
    const config = { ...DEFAULT_CONFIG, dailyGoal: 6, longBreakEvery: 3 };
    const { lastFrame } = render(
      <App
        store={store}
        readEffectiveConfigFn={() => config}
        exitFn={vi.fn()}
      />,
    );
    // The initial project picker is shown; skip to the dot row check
    // Dots should be 6 total (goal=6) — 6 empty circles, no filled
    const frame = lastFrame() ?? "";
    const totalDots = (frame.match(/[●○]/g) ?? []).length;
    expect(totalDots).toBe(6);
  });
});

describe("derivePhaseState — count from completions", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = Date.now();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts today's completions even when state.json has been cleared", () => {
    const lines = [
      { completedAt: NOW - 60_000, durationMs: 1_500_000, project: "p1" },
      { completedAt: NOW - 30_000, durationMs: 1_500_000, project: "p2" },
    ];
    writeFileSync(
      join(tmpDir, "completions.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      "utf8",
    );

    const view = derivePhaseState(null, NOW, store);
    expect(view.completedFocusBlocks).toBe(2);
  });

  it("survives focus → break → focus by reading completions.jsonl", () => {
    // First focus block completed, state.json now reflects a break that has
    // also expired so the next focus block writes into a cleared state.
    writeFileSync(
      join(tmpDir, "completions.jsonl"),
      JSON.stringify({
        completedAt: NOW - 600_000,
        durationMs: 1_500_000,
        project: "p1",
      }) + "\n",
      "utf8",
    );
    // record is for a freshly-started focus block with completedFocusBlocks=0
    const record = {
      startedAt: NOW,
      durationMs: 1_500_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "p1",
      phase: "focus" as const,
      completedFocusBlocks: 0,
    };

    const view = derivePhaseState(record, NOW, store);
    expect(view.completedFocusBlocks).toBe(1);
  });

  it("ignores yesterday's completions", () => {
    const yesterday = NOW - 24 * 60 * 60 * 1000;
    writeFileSync(
      join(tmpDir, "completions.jsonl"),
      JSON.stringify({
        completedAt: yesterday,
        durationMs: 1_500_000,
        project: "p1",
      }) + "\n",
      "utf8",
    );
    const view = derivePhaseState(null, NOW, store);
    expect(view.completedFocusBlocks).toBe(0);
  });
});
