import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import CountdownView from "../tui/CountdownView.js";

afterEach(() => {
  cleanup();
});

describe("CountdownView — phase label", () => {
  it("shows FOCUS label in focus phase", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={0}
        paused={false}
      />,
    );
    expect(lastFrame()).toContain("FOCUS");
  });

  it("shows BREAK label in break phase", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="break"
        remainingMs={5 * 60 * 1000}
        completedFocusBlocks={1}
        paused={false}
      />,
    );
    expect(lastFrame()).toContain("BREAK");
  });
});

describe("CountdownView — color", () => {
  it("uses red ANSI color for focus phase", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={0}
        paused={false}
      />,
    );
    // ANSI red = \x1b[31m or within color escape sequences
    expect(lastFrame()).toMatch(/\x1b\[.*?31.*?m|\x1b\[31m/);
  });

  it("uses green ANSI color for break phase", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="break"
        remainingMs={5 * 60 * 1000}
        completedFocusBlocks={1}
        paused={false}
      />,
    );
    expect(lastFrame()).toMatch(/\x1b\[.*?32.*?m|\x1b\[32m/);
  });
});

describe("CountdownView — project name", () => {
  it("renders project name when provided", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={0}
        paused={false}
        project="my-project"
      />,
    );
    expect(lastFrame()).toContain("my-project");
  });
});

describe("CountdownView — hint line", () => {
  it("renders the hint line with all key bindings", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={0}
        paused={false}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("space pause");
    expect(frame).toContain("q");
    expect(frame).toContain("detach");
  });

  it("shows 'pause' hint for space during focus phase", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="focus"
        remainingMs={25 * 60 * 1000}
        completedFocusBlocks={0}
        paused={false}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("space pause");
    expect(frame).not.toContain("space skip");
  });

  it("shows 'skip' hint for space during break phase", () => {
    const { lastFrame } = render(
      <CountdownView
        phase="break"
        remainingMs={5 * 60 * 1000}
        completedFocusBlocks={1}
        paused={false}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("space skip");
    expect(frame).not.toContain("space pause");
  });
});
