import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import App from "../tui/App.js";
import type { StateRecord } from "../state.js";
import type { ProjectRecord } from "../projects.js";

const flush = () => Promise.resolve();

const alpha: ProjectRecord = { name: "alpha", archived: false, createdAt: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("launch-attach-or-fresh — attach to running timer", () => {
  it("shows FOCUS label and project name from running state record", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const record: StateRecord = {
      startedAt: now - 20 * 60 * 1000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "my-project",
    };

    const { lastFrame } = render(
      <App readStateFn={() => record} getProjects={() => []} />,
    );

    expect(lastFrame()).toContain("FOCUS");
    expect(lastFrame()).toContain("my-project");
  });

  it("shows red ANSI color for a running (non-paused) timer", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const record: StateRecord = {
      startedAt: now - 5 * 60 * 1000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };

    const { lastFrame } = render(
      <App readStateFn={() => record} getProjects={() => []} />,
    );

    expect(lastFrame()).toMatch(/\x1b\[.*?31.*?m|\x1b\[31m/);
  });

  it("does NOT show the project picker overlay when attaching to a running timer", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const record: StateRecord = {
      startedAt: now - 5 * 60 * 1000,
      durationMs: 25 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };

    const { lastFrame } = render(
      <App readStateFn={() => record} getProjects={() => [alpha]} />,
    );

    expect(lastFrame()).not.toContain("Applies from next block");
  });
});

describe("launch-attach-or-fresh — attach to paused timer", () => {
  it("shows gray ANSI color for a paused timer", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const record: StateRecord = {
      startedAt: now - 10 * 60 * 1000,
      durationMs: 25 * 60 * 1000,
      pausedAt: now - 60 * 1000,
      accumulatedPauseMs: 0,
      project: "paused-project",
    };

    const { lastFrame } = render(
      <App readStateFn={() => record} getProjects={() => []} />,
    );

    expect(lastFrame()).toMatch(/\x1b\[2m|\x1b\[.*?90.*?m/);
    expect(lastFrame()).toContain("paused-project");
  });
});

describe("launch-attach-or-fresh — idle auto-opens project picker", () => {
  it("shows project picker automatically when no state record exists", () => {
    const { lastFrame } = render(
      <App readStateFn={() => null} getProjects={() => [alpha]} />,
    );

    expect(lastFrame()).toContain("Applies from next block");
  });

  it("project picker lists the available projects when auto-opened", () => {
    const { lastFrame } = render(
      <App readStateFn={() => null} getProjects={() => [alpha]} />,
    );

    expect(lastFrame()).toContain("alpha");
  });

  it("pressing escape on the auto-opened picker closes it and shows the timer", async () => {
    const { lastFrame, stdin } = render(
      <App readStateFn={() => null} getProjects={() => []} />,
    );

    expect(lastFrame()).toContain("Applies from next block");

    stdin.write("\x1B");
    vi.advanceTimersByTime(100);
    await flush();

    expect(lastFrame()).not.toContain("Applies from next block");
    expect(lastFrame()).toContain("FOCUS");
  });
});
