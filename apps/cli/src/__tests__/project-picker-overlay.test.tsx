import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import ProjectPickerOverlay from "../tui/ProjectPickerOverlay.js";
import App from "../tui/App.js";
import type { ProjectRecord } from "../projects.js";

const flush = () => Promise.resolve();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const alpha: ProjectRecord = { name: "alpha", archived: false, createdAt: "2026-01-01T00:00:00.000Z" };
const beta: ProjectRecord = { name: "beta", archived: false, createdAt: "2026-01-02T00:00:00.000Z" };

describe("ProjectPickerOverlay — list rendering", () => {
  it("shows all project names", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
  });

  it("shows a 'new…' entry", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(lastFrame()).toContain("new…");
  });

  it("shows the 'Applies from next block' hint", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[alpha]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(lastFrame()).toContain("Applies from next block");
  });

  it("shows the first item highlighted initially", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> alpha");
    expect(frame).not.toContain("> beta");
  });
});

describe("ProjectPickerOverlay — navigation", () => {
  it("down arrow moves the selection to the next item", async () => {
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // down arrow
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("> beta");
    expect(frame).not.toContain("> alpha");
  });

  it("up arrow does not go above the first item", async () => {
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[A"); // up arrow when already at top
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("> alpha");
    expect(frame).not.toContain("> beta");
  });
});

describe("ProjectPickerOverlay — selection", () => {
  it("pressing enter calls onSelect with the highlighted project name", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\r");
    await flush();

    expect(onSelect).toHaveBeenCalledWith("alpha");
  });

  it("pressing down then enter selects the second item", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B");
    await flush();
    stdin.write("\r");
    await flush();

    expect(onSelect).toHaveBeenCalledWith("beta");
  });

  it("pressing escape calls onClose without selecting", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[alpha]} onSelect={onSelect} onClose={onClose} />,
    );

    stdin.write("\x1B");
    vi.runAllTimers(); // advance Ink's escape-detection timeout
    await flush();

    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ProjectPickerOverlay — new project creation", () => {
  it("selecting 'new…' shows the text input prompt", async () => {
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    // With no projects, first and only entry is "new…"
    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain("New project:");
  });

  it("typing a name and pressing enter calls onSelect with the new name", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\r"); // select "new…"
    await flush();

    stdin.write("m");
    await flush();
    stdin.write("y");
    await flush();

    stdin.write("\r"); // confirm
    await flush();

    expect(onSelect).toHaveBeenCalledWith("my");
  });

  it("backspace removes the last typed character", async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\r"); // select "new…"
    await flush();

    stdin.write("m");
    await flush();
    stdin.write("y");
    await flush();
    stdin.write("\x7f"); // backspace (DEL)
    await flush();

    stdin.write("\r"); // confirm "m" only
    await flush();

    expect(onSelect).toHaveBeenCalledWith("m");
  });

  it("pressing escape in text input mode returns to the list", async () => {
    const onClose = vi.fn();
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={onClose} />,
    );

    stdin.write("\r"); // select "new…"
    await flush();

    expect(lastFrame()).toContain("New project:");

    stdin.write("\x1B"); // escape
    vi.runAllTimers(); // advance Ink's escape-detection timeout
    await flush();

    // Should be back in the list (no "New project:" prompt)
    expect(lastFrame()).not.toContain("New project:");
    // onClose should NOT have been called yet
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("App — project picker integration", () => {
  it("pressing p opens the project picker overlay", async () => {
    const { lastFrame, stdin } = render(
      <App getProjects={() => [alpha]} />,
    );

    stdin.write("p");
    await flush();

    expect(lastFrame()).toContain("Applies from next block");
  });

  it("selecting a project from the picker shows it in the countdown view", async () => {
    const { lastFrame, stdin } = render(
      <App getProjects={() => [alpha]} />,
    );

    stdin.write("p");
    await flush();

    stdin.write("\r"); // select alpha
    await flush();

    expect(lastFrame()).toContain("alpha");
    expect(lastFrame()).not.toContain("Applies from next block"); // overlay closed
  });
});
