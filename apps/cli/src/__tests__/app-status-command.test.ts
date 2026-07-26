import { describe, expect, it } from "vitest";
import { runAppStatus } from "../commands/app.js";

function harness(overrides: {
  json?: boolean;
  installedVersion?: string | null;
  bundledVersion?: string | null;
  running?: boolean;
  loginItem?: boolean;
}) {
  const out: string[] = [];
  const installedVersion = overrides.installedVersion ?? null;
  const bundledVersion = overrides.bundledVersion ?? null;

  const code = runAppStatus({
    json: overrides.json ?? false,
    bundled: {
      locate: () =>
        bundledVersion === null
          ? { present: false, reason: "no bundled app zip in this install" }
          : {
              present: true,
              zipPath: "/pkg/bundled-app/pmdr-app.zip",
              version: bundledVersion,
            },
    },
    probes: {
      probeInstalled: () =>
        installedVersion === null
          ? { present: false }
          : {
              present: true,
              appPath: "/Users/x/Applications/pmdr.app",
              version: installedVersion,
            },
      probeRunning: () => overrides.running ?? false,
      probeLoginItem: () => overrides.loginItem ?? false,
    },
    stdout: (line) => out.push(line),
  });

  return { code, out };
}

describe("pmdr app status", () => {
  it("emits one line of machine-readable JSON with --json", () => {
    const { code, out } = harness({
      json: true,
      installedVersion: "0.4.1",
      bundledVersion: "0.5.0",
      running: true,
      loginItem: true,
    });

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({
      install: "stale",
      installedVersion: "0.4.1",
      installedPath: "/Users/x/Applications/pmdr.app",
      bundledVersion: "0.5.0",
      bundledReason: null,
      running: true,
      loginItem: true,
    });
  });

  it("reports honestly with --json when nothing is installed", () => {
    const { code, out } = harness({ json: true, bundledVersion: "0.5.0" });

    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({
      install: "absent",
      installedVersion: null,
      running: false,
      loginItem: false,
    });
  });

  it("prints a human summary by default", () => {
    const { code, out } = harness({
      installedVersion: "0.4.1",
      bundledVersion: "0.4.1",
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("up to date");
  });
});
