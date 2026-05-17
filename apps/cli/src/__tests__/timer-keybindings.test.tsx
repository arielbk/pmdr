import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, cleanup } from "ink-testing-library";
import App from "../tui/App.js";
import { createStateModule } from "../state.js";
import type { StateRecord } from "../state.js";

const makeRunningRecord = (): StateRecord => ({
  startedAt: Date.now() - 60_000,
  durationMs: 25 * 60 * 1000,
  pausedAt: null,
  accumulatedPauseMs: 0,
});

// ink's useInput dispatches state updates as microtasks via discreteUpdates;
// awaiting a resolved promise lets React flush the render before asserting.
const flush = () => Promise.resolve();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("timer-keybindings — space toggles pause/resume", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    vi.setSystemTime(NOW);
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-toggle-test-"));
    store = createStateModule(tmpDir);
    store.writeState({
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pressing space pauses the timer (shows dim/gray state)", async () => {
    const { lastFrame, stdin } = render(<App store={store} exitFn={vi.fn()} />);

    expect(lastFrame()).toMatch(/\x1b\[.*?31.*?m|\x1b\[31m/);

    stdin.write(" ");
    await flush();

    expect(lastFrame()).toMatch(/\x1b\[2m|\x1b\[.*?90.*?m/);
  });

  it("pressing space twice resumes the timer (back to red)", async () => {
    const { lastFrame, stdin } = render(<App store={store} exitFn={vi.fn()} />);

    stdin.write(" ");
    await flush();

    stdin.write(" ");
    await flush();

    expect(lastFrame()).toMatch(/\x1b\[.*?31.*?m|\x1b\[31m/);
  });
});

describe("timer-keybindings — s is no longer bound", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    vi.setSystemTime(NOW);
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-skip-removed-test-"));
    store = createStateModule(tmpDir);
    store.writeState({
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pressing s leaves the timer in focus and does not mutate state.json", async () => {
    const stateJsonPath = join(tmpDir, "state.json");
    const before = readFileSync(stateJsonPath, "utf8");

    const { lastFrame, stdin } = render(<App store={store} exitFn={vi.fn()} />);

    expect(lastFrame()).toContain("FOCUS");

    stdin.write("s");
    await flush();

    expect(lastFrame()).toContain("FOCUS");
    expect(lastFrame()).not.toContain("BREAK");
    expect(readFileSync(stateJsonPath, "utf8")).toBe(before);
  });
});

describe("timer-keybindings — x stops session", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    vi.setSystemTime(NOW);
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-stop-test-"));
    store = createStateModule(tmpDir);
    store.writeState({
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pressing x clears state.json and stays in the TUI with the project picker", async () => {
    const mockExit = vi.fn();
    const { lastFrame, stdin } = render(
      <App
        store={store}
        exitFn={mockExit}
        getProjects={() => [{ name: "demo", archived: false } as any]}
      />,
    );

    stdin.write("x");
    await flush();

    expect(store.readState()).toBeNull();
    expect(mockExit).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("demo");
  });
});

describe("timer-keybindings — q quits", () => {
  it("pressing q unmounts the app without throwing", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} />);

    expect(lastFrame()).toContain("FOCUS");

    expect(() => stdin.write("q")).not.toThrow();
  });
});

describe("timer-keybindings — space persists pause/resume to state.json", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  const NOW = 1_000_000;

  beforeEach(() => {
    vi.setSystemTime(NOW);
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-persist-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pressing space on a running timer writes pausedAt=now to state.json", async () => {
    store.writeState({
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });

    const { stdin } = render(<App store={store} exitFn={vi.fn()} />);

    stdin.write(" ");
    await flush();

    const file = store.readState();
    expect(file?.pausedAt).toBe(NOW);
  });

  it("pressing space on a paused timer clears pausedAt and accumulates pause duration", async () => {
    store.writeState({
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: NOW - 10_000,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });

    const { stdin } = render(<App store={store} exitFn={vi.fn()} />);

    stdin.write(" ");
    await flush();

    const file = store.readState();
    expect(file?.pausedAt).toBeNull();
    expect(file?.accumulatedPauseMs).toBe(10_000);
  });
});

describe("timer-keybindings — detach keys call exit() and leave state.json untouched", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  const NOW = 1_000_000;

  beforeEach(() => {
    vi.setSystemTime(NOW);
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-detach-test-"));
    store = createStateModule(tmpDir);
    const record: StateRecord = {
      startedAt: NOW - 60_000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(record);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pressing q calls exitFn and does not mutate state.json", async () => {
    const mockExit = vi.fn();
    const stateJsonPath = join(tmpDir, "state.json");
    const before = readFileSync(stateJsonPath, "utf8");

    const { stdin } = render(
      <App readStateFn={() => store.readState()} exitFn={mockExit} />,
    );

    stdin.write("q");
    await flush();

    expect(mockExit).toHaveBeenCalled();
    expect(readFileSync(stateJsonPath, "utf8")).toBe(before);
  });

  it("pressing Ctrl+C calls exitFn and does not mutate state.json", async () => {
    const mockExit = vi.fn();
    const stateJsonPath = join(tmpDir, "state.json");
    const before = readFileSync(stateJsonPath, "utf8");

    const { stdin } = render(
      <App readStateFn={() => store.readState()} exitFn={mockExit} />,
    );

    stdin.write("\x03");
    await flush();

    expect(mockExit).toHaveBeenCalled();
    expect(readFileSync(stateJsonPath, "utf8")).toBe(before);
  });

  it("pressing Esc calls exitFn and does not mutate state.json", async () => {
    const mockExit = vi.fn();
    const stateJsonPath = join(tmpDir, "state.json");
    const before = readFileSync(stateJsonPath, "utf8");

    const { stdin } = render(
      <App readStateFn={() => store.readState()} exitFn={mockExit} />,
    );

    stdin.write("\x1B");
    vi.advanceTimersByTime(100); // ink waits briefly to disambiguate bare ESC from escape sequences
    await flush();

    expect(mockExit).toHaveBeenCalled();
    expect(readFileSync(stateJsonPath, "utf8")).toBe(before);
  });
});
