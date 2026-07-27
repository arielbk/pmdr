import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliVersion } from "../version.js";

describe("cliVersion", () => {
  it("reads the CLI's own package version", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf8"),
    ) as { version: string };

    expect(cliVersion()).toBe(pkg.version);
  });

  /**
   * The bug this guards: reading `package.json` from a module under `src/`
   * resolved fine in source and threw `MODULE_NOT_FOUND` in the bundle, because
   * tsup flattens every module into `dist/index.js`. One helper with one
   * `../package.json` is correct from both — see the integration test that
   * asserts `pmdr --version` off the built bundle.
   */
  it("returns a dotted version rather than throwing", () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
