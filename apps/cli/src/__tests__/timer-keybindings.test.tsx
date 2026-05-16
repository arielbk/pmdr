import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import App from "../tui/App.js";
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
  it("pressing space pauses the timer (shows dim/gray state)", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} />);

    // Initially running — ANSI red for focus
    expect(lastFrame()).toMatch(/\x1b\[.*?31.*?m|\x1b\[31m/);

    stdin.write(" ");
    await flush();

    // Paused state uses gray (dim ANSI code \x1b[2m or gray color)
    expect(lastFrame()).toMatch(/\x1b\[2m|\x1b\[.*?90.*?m/);
  });

  it("pressing space twice resumes the timer (back to red)", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} />);

    stdin.write(" ");
    await flush();

    stdin.write(" ");
    await flush();

    // After resume, focus is red again
    expect(lastFrame()).toMatch(/\x1b\[.*?31.*?m|\x1b\[31m/);
  });
});

describe("timer-keybindings — s skips phase", () => {
  it("pressing s transitions from focus to break", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} />);

    expect(lastFrame()).toContain("FOCUS");

    stdin.write("s");
    await flush();

    expect(lastFrame()).toContain("BREAK");
  });

  it("pressing s while paused still skips to break", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} />);

    stdin.write(" ");
    await flush();

    stdin.write("s");
    await flush();

    expect(lastFrame()).toContain("BREAK");
  });
});

describe("timer-keybindings — q quits", () => {
  it("pressing q unmounts the app without throwing", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} />);

    expect(lastFrame()).toContain("FOCUS");

    expect(() => stdin.write("q")).not.toThrow();
  });
});
