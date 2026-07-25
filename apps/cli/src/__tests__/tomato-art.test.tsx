import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "ink-testing-library";
import TomatoArt from "../tui/TomatoArt.js";

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);
const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");

afterEach(() => {
  cleanup();
});

describe("TomatoArt", () => {
  it("renders the compact brand silhouette", () => {
    const { lastFrame } = render(<TomatoArt paused={false} />);
    const frame = stripAnsi(lastFrame() ?? "");

    expect(frame).toContain("\\ | /");
    expect(frame).toContain(".--\\|/--.");
    expect(frame).toContain("\\__/\\_/\\__/");
    expect(frame).not.toContain("█");
  });

  it("keeps the brand silhouette while the timer is paused", () => {
    const { lastFrame } = render(<TomatoArt paused />);

    expect(stripAnsi(lastFrame() ?? "")).toContain(".--\\|/--.");
  });
});
