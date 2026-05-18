import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, cleanup } from "ink-testing-library";
import CountdownView from "../tui/CountdownView.js";
import { derivePhaseState } from "../tui/phase-state-machine.js";
import { createStateModule } from "../state.js";

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
