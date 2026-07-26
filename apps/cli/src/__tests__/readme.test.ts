import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("README CLI documentation", () => {
  const readme = readFileSync(join(__dirname, "../../../../README.md"), "utf8");

  it("documents serving the LAN status page", () => {
    const runningCliSection = readme.match(
      /## Running the CLI([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(runningCliSection).toContain("pmdr serve");
    expect(runningCliSection).toContain("--port");
    expect(runningCliSection).toContain("http://<machine-name>.local:<port>");
  });

  it("documents installing the bundled menubar app from the CLI", () => {
    const section = readme.match(
      /## The bundled menubar app([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(section).toContain("pmdr app install");
    expect(section).toContain("pmdr app status --json");
    expect(section).toContain("pmdr app uninstall");
    expect(section).toContain("~/Applications");
  });
});
