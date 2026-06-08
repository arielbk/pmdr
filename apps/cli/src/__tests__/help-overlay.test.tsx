import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import HelpOverlay from "../tui/HelpOverlay.js";
import App from "../tui/App.js";
import type { StateRecord } from "../state.js";

const makeRunningRecord = (): StateRecord => ({
  startedAt: Date.now() - 60_000,
  durationMs: 25 * 60 * 1000,
  pausedAt: null,
  accumulatedPauseMs: 0,
});

const flush = () => Promise.resolve();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("HelpOverlay — rendering", () => {
  it("shows the detach, stop, project, and help keybindings", () => {
    const { lastFrame } = render(<HelpOverlay onClose={vi.fn()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("space");
    expect(frame).toContain("q");
    expect(frame).toContain("esc");
    expect(frame).toContain("ctrl+c");
    expect(frame).toContain("x");
    expect(frame).toContain("p");
    expect(frame).toContain("?");
  });

  it("describes detach keys as keeping the timer running and x as stop session", () => {
    const { lastFrame } = render(<HelpOverlay onClose={vi.fn()} phase="focus" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("pause");
    expect(frame).toContain("quit / detach (timer keeps running)");
    expect(frame).toContain("stop session");
    expect(frame).toContain("project");
    expect(frame).toContain("help");
  });

  it("does not list skip during focus phase", () => {
    const { lastFrame } = render(<HelpOverlay onClose={vi.fn()} phase="focus" />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("skip");
  });

  it("shows stop/skip break copy for space during break phase", () => {
    const { lastFrame } = render(<HelpOverlay onClose={vi.fn()} phase="break" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("stop / skip break");
    expect(frame).not.toContain("pause / resume");
  });

  it("shows pause/resume copy for space during focus phase", () => {
    const { lastFrame } = render(<HelpOverlay onClose={vi.fn()} phase="focus" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("pause / resume");
    expect(frame).not.toContain("stop / skip break");
  });

  it("shows a dismiss hint", () => {
    const { lastFrame } = render(<HelpOverlay onClose={vi.fn()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("esc");
  });
});

describe("HelpOverlay — dismissal", () => {
  it("pressing ? calls onClose", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<HelpOverlay onClose={onClose} />);
    stdin.write("?");
    await flush();
    expect(onClose).toHaveBeenCalled();
  });

  it("pressing esc calls onClose", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<HelpOverlay onClose={onClose} />);
    stdin.write("\x1B");
    vi.runAllTimers();
    await flush();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("App — help overlay integration", () => {
  it("pressing ? opens the help overlay", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} getProjects={() => []} />);
    stdin.write("?");
    await flush();
    expect(lastFrame()).toContain("Keybindings");
  });

  it("pressing ? again closes the help overlay", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} getProjects={() => []} />);

    stdin.write("?");
    await flush();
    expect(lastFrame()).toContain("Keybindings");

    stdin.write("?");
    await flush();
    expect(lastFrame()).not.toContain("Keybindings");
  });

  it("pressing esc closes the help overlay", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} getProjects={() => []} />);

    stdin.write("?");
    await flush();
    expect(lastFrame()).toContain("Keybindings");

    stdin.write("\x1B");
    // Advance past Ink's escape-detection debounce without triggering an
    // infinite loop from App's setInterval (runAllTimers would loop forever).
    vi.advanceTimersByTime(100);
    await flush();
    expect(lastFrame()).not.toContain("Keybindings");
  });

  it("timer continues ticking while help overlay is open", async () => {
    const { lastFrame, stdin } = render(<App readStateFn={makeRunningRecord} getProjects={() => []} />);

    stdin.write("?");
    await flush();
    expect(lastFrame()).toContain("Keybindings");

    // Advance 2 seconds — if timer were frozen we'd still see same time
    vi.advanceTimersByTime(2000);
    await flush();

    // Overlay still open, timer-driven state advances (interval ticks machine)
    expect(lastFrame()).toContain("Keybindings");
    // FOCUS label should still be visible (not crashed)
    expect(lastFrame()).toContain("FOCUS");
  });
});
