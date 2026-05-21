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

  it("shows a 'New' entry", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(lastFrame()).toContain("New");
  });

  it("shows a 'None' entry even when there are no projects", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(lastFrame()).toContain("None");
  });

  it("shows the 'Applies from next block' hint", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[alpha]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(lastFrame()).toContain("Applies from next block");
  });

  it("shows None highlighted initially (it's first)", () => {
    const { lastFrame } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> None");
  });
});

describe("ProjectPickerOverlay — navigation", () => {
  it("down arrow moves the selection to the next item", async () => {
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    // Entries: None, alpha, beta, New. From None, down → alpha, down → beta.
    stdin.write("\x1B[B");
    await flush();
    stdin.write("\x1B[B");
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
    expect(frame).toContain("> None");
  });
});

describe("ProjectPickerOverlay — selection", () => {
  it("pressing down then enter selects the first project", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // past None to alpha
    await flush();
    stdin.write("\r");
    await flush();

    expect(onSelect).toHaveBeenCalledWith("alpha");
  });

  it("pressing down twice then enter selects the second project", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[alpha, beta]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B");
    await flush();
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

describe("ProjectPickerOverlay — None selection", () => {
  it("selecting None calls onSelect with null", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    // With no projects, entries are None, New. First is None.
    stdin.write("\r");
    await flush();

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("ProjectPickerOverlay — new project creation", () => {
  it("typing while on New inlines characters into the entry label", async () => {
    const { lastFrame, stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // down to New
    await flush();
    stdin.write("m");
    await flush();
    stdin.write("y");
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("New: my");
  });

  it("typing on New and pressing enter calls onSelect with the new name", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // down to New
    await flush();
    stdin.write("m");
    await flush();
    stdin.write("y");
    await flush();
    stdin.write("\r");
    await flush();

    expect(onSelect).toHaveBeenCalledWith("my");
  });

  it("backspace removes the last typed character", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // down to New
    await flush();
    stdin.write("m");
    await flush();
    stdin.write("y");
    await flush();
    stdin.write("\x7f"); // backspace
    await flush();
    stdin.write("\r");
    await flush();

    expect(onSelect).toHaveBeenCalledWith("m");
  });

  it("navigating away from New resets the typed buffer", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // down to New
    await flush();
    stdin.write("m");
    await flush();
    stdin.write("y");
    await flush();

    stdin.write("\x1B[A"); // back to None
    await flush();
    stdin.write("\x1B[B"); // back to New
    await flush();
    stdin.write("\r"); // enter with empty buffer — should not select
    await flush();

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("pressing escape from the New entry closes the overlay", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay projects={[]} onSelect={vi.fn()} onClose={onClose} />,
    );

    stdin.write("\x1B[B"); // down to New
    await flush();
    stdin.write("\x1B"); // escape
    vi.runAllTimers();
    await flush();

    expect(onClose).toHaveBeenCalled();
  });
});

describe("ProjectPickerOverlay — archive keybinding", () => {
  it("pressing 'a' on a highlighted project row calls onArchive with that name", async () => {
    const onArchive = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay
        projects={[alpha, beta]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onArchive={onArchive}
      />,
    );

    stdin.write("\x1B[B"); // past None to alpha
    await flush();
    stdin.write("a");
    await flush();

    expect(onArchive).toHaveBeenCalledWith("alpha");
  });

  it("pressing 'a' while highlighting None does not call onArchive", async () => {
    const onArchive = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay
        projects={[alpha]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onArchive={onArchive}
      />,
    );

    // selectedIdx starts at 0 = None
    stdin.write("a");
    await flush();

    expect(onArchive).not.toHaveBeenCalled();
  });

  it("pressing 'a' while on the New entry types 'a' into the buffer (no archive)", async () => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    const { stdin } = render(
      <ProjectPickerOverlay
        projects={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
        onArchive={onArchive}
      />,
    );

    stdin.write("\x1B[B"); // down to New
    await flush();
    stdin.write("a");
    await flush();
    stdin.write("\r");
    await flush();

    expect(onArchive).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("a");
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

    stdin.write("\x1B[B"); // past None to alpha
    await flush();
    stdin.write("\r"); // select alpha
    await flush();

    expect(lastFrame()).toContain("alpha");
    expect(lastFrame()).not.toContain("Applies from next block"); // overlay closed
  });

  it("pressing 'a' on a highlighted project archives it and the row disappears", async () => {
    // Simulate the projects store: after archive, the project is filtered out.
    const archived = new Set<string>();
    const getProjects = vi.fn(() =>
      [alpha, beta].filter((p) => !archived.has(p.name)),
    );
    const archiveSpy = vi.fn((name: string) => {
      archived.add(name);
    });

    const { lastFrame, stdin } = render(
      <App
        getProjects={getProjects}
        archiveProjectFn={archiveSpy}
        readStateFn={() => null}
      />,
    );

    stdin.write("p");
    await flush();

    // initial frame contains both projects as picker rows
    expect(lastFrame()).toMatch(/[> ] alpha/);
    expect(lastFrame()).toMatch(/[> ] beta/);

    stdin.write("\x1B[B"); // past None to alpha
    await flush();
    stdin.write("a"); // archive alpha
    await flush();

    expect(archiveSpy).toHaveBeenCalledWith("alpha");

    const frame = lastFrame() ?? "";
    // alpha row should be gone; beta still present
    expect(frame).not.toMatch(/[> ] alpha/);
    expect(frame).toMatch(/[> ] beta/);
  });
});
