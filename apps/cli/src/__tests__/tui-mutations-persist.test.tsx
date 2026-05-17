import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, cleanup } from "ink-testing-library";
import App from "../tui/App.js";
import { createStateModule } from "../state.js";
import { getStatus } from "../commands/status.js";

const flush = () => Promise.resolve();

const NOW = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("tui-mutations-persist — TUI mutations are visible to commands", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-integration-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("attach → space → status reports paused; space again → status reports running", async () => {
    store.writeState({
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
      project: "p",
    });

    // Sanity: status reports running before any TUI interaction
    expect(getStatus({ store, now: NOW }).state).toBe("running");

    const { stdin } = render(<App store={store} exitFn={vi.fn()} />);

    stdin.write(" ");
    await flush();

    expect(getStatus({ store, now: NOW }).state).toBe("paused");

    stdin.write(" ");
    await flush();

    expect(getStatus({ store, now: NOW }).state).toBe("running");
  });
});
