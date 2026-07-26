import { describe, expect, it } from "vitest";
import {
  installOptionsFromArgs,
  runAppInstall,
  runAppUninstall,
} from "../app-install.js";
import type { InstallSystem } from "../app-install.js";

const HOME = "/Users/x";
const APP = "/Users/x/Applications/pmdr.app";
const ZIP = "/pkg/bundled-app/pmdr-app.zip";
const STAGING = "/tmp/pmdr-install-1";

interface FakeOptions {
  present?: string[];
  failing?: keyof InstallSystem;
}

/** Records every side effect in order, so tests can assert on sequencing. */
function fakeSystem(options: FakeOptions = {}) {
  const calls: string[] = [];
  const present = new Set(options.present ?? []);

  const record = <T>(name: keyof InstallSystem, detail: string, result: T): T => {
    calls.push(detail);
    if (options.failing === name) throw new Error(`${name} blew up`);
    return result;
  };

  const system: InstallSystem = {
    exists: (path) => present.has(path),
    mkdtemp: () => record("mkdtemp", "mkdtemp", STAGING),
    mkdirp: (dir) => record("mkdirp", `mkdirp ${dir}`, undefined),
    remove: (path) => record("remove", `remove ${path}`, undefined),
    move: (from, to) => record("move", `move ${from} -> ${to}`, undefined),
    extract: (zip, dest) => {
      present.add(`${dest}/pmdr.app`);
      return record("extract", `extract ${zip} -> ${dest}`, undefined);
    },
    quitApp: () => record("quitApp", "quit", undefined),
    launchApp: (path) => record("launchApp", `launch ${path}`, undefined),
  };

  return { system, calls, present };
}

function harness(
  overrides: {
    platform?: string;
    force?: boolean;
    noLaunch?: boolean;
    bundledVersion?: string | null;
    installedVersion?: string | null;
    running?: boolean;
  } = {},
  fake = fakeSystem(),
) {
  const out: string[] = [];
  const err: string[] = [];
  const bundledVersion = overrides.bundledVersion ?? null;
  const installedVersion = overrides.installedVersion ?? null;

  const code = runAppInstall({
    platform: overrides.platform ?? "darwin",
    home: HOME,
    force: overrides.force,
    noLaunch: overrides.noLaunch,
    bundled: {
      locate: () =>
        bundledVersion === null
          ? { present: false, reason: "no bundled app zip in this install" }
          : { present: true, zipPath: ZIP, version: bundledVersion },
    },
    probes: {
      probeInstalled: () =>
        installedVersion === null
          ? { present: false }
          : { present: true, appPath: APP, version: installedVersion },
      probeRunning: () => overrides.running ?? false,
    },
    system: fake.system,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });

  return { code, out, err, calls: fake.calls, present: fake.present };
}

describe("pmdr app install", () => {
  it("fails with one clear line on a non-macOS machine", () => {
    const { code, out, err } = harness({ platform: "linux" });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("macOS");
  });

  it("fails without touching the filesystem when this CLI carries no app", () => {
    const { code, err, calls } = harness({ bundledVersion: null });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("\n")).toContain("no bundled app zip in this install");
  });

  it("is a no-op when the installed app is already the bundled version", () => {
    const { code, out, calls } = harness({
      bundledVersion: "0.5.0",
      installedVersion: "0.5.0",
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out.join("\n")).toContain("already installed");
  });

  it("reinstalls the same version anyway under --force", () => {
    const { code, calls } = harness({
      bundledVersion: "0.5.0",
      installedVersion: "0.5.0",
      force: true,
    });

    expect(code).toBe(0);
    expect(calls).not.toEqual([]);
  });

  it("stages the extract, quits the running app, then swaps it into place", () => {
    const { code, out, calls } = harness(
      { bundledVersion: "0.5.0", installedVersion: "0.4.1", running: true },
      fakeSystem({ present: [APP] }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      "mkdtemp",
      `extract ${ZIP} -> ${STAGING}`,
      "quit",
      "mkdirp /Users/x/Applications",
      `remove ${APP}`,
      `move ${STAGING}/pmdr.app -> ${APP}`,
      `remove ${STAGING}`,
      `launch ${APP}`,
    ]);
    expect(out.join("\n")).toContain("0.5.0");
  });

  it("does not quit anything when the app is not running", () => {
    const { calls } = harness({ bundledVersion: "0.5.0" });

    expect(calls).not.toContain("quit");
  });

  it("leaves the app unlaunched with --no-launch", () => {
    const { code, calls } = harness({ bundledVersion: "0.5.0", noLaunch: true });

    expect(code).toBe(0);
    expect(calls.some((call) => call.startsWith("launch"))).toBe(false);
  });

  it("fails, cleans up staging and leaves the install alone when the extract fails", () => {
    const { code, err, calls } = harness(
      { bundledVersion: "0.5.0", installedVersion: "0.4.1", running: true },
      fakeSystem({ present: [APP], failing: "extract" }),
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("extract blew up");
    expect(calls).toEqual([
      "mkdtemp",
      `extract ${ZIP} -> ${STAGING}`,
      `remove ${STAGING}`,
    ]);
  });

  it("says the app installed but could not launch, without a stack trace", () => {
    const { code, out, err } = harness(
      { bundledVersion: "0.5.0" },
      fakeSystem({ failing: "launchApp" }),
    );

    expect(out.join("\n")).toContain("0.5.0 installed");
    expect(err.join("\n")).toContain("installed but could not be launched");
    expect(err.join("\n")).toContain("launchApp blew up");
    expect(code).toBe(1);
  });

  it("fails when the swap into Applications fails", () => {
    const { code, err } = harness(
      { bundledVersion: "0.5.0" },
      fakeSystem({ failing: "move" }),
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("move blew up");
  });
});

const PLIST = "/Users/x/Library/LaunchAgents/dev.pmdr.menubar.plist";

function uninstallHarness(
  overrides: { platform?: string; running?: boolean } = {},
  fake = fakeSystem(),
) {
  const out: string[] = [];
  const err: string[] = [];

  const code = runAppUninstall({
    platform: overrides.platform ?? "darwin",
    home: HOME,
    probes: { probeRunning: () => overrides.running ?? false },
    system: fake.system,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });

  return { code, out, err, calls: fake.calls };
}

describe("pmdr app uninstall", () => {
  it("fails with one clear line on a non-macOS machine", () => {
    const { code, err, calls } = uninstallHarness({ platform: "linux" });

    expect(code).toBe(1);
    expect(err[0]).toContain("macOS");
    expect(calls).toEqual([]);
  });

  it("quits the app, removes the bundle and removes the login item", () => {
    const { code, out, calls } = uninstallHarness(
      { running: true },
      fakeSystem({ present: [APP, PLIST] }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual(["quit", `remove ${APP}`, `remove ${PLIST}`]);
    expect(out.join("\n")).toContain(APP);
  });

  it("is a no-op that still succeeds when nothing is installed", () => {
    const { code, out, calls } = uninstallHarness();

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out.join("\n")).toContain("nothing to remove");
  });

  it("removes a leftover login item even when the bundle is already gone", () => {
    const { code, calls } = uninstallHarness({}, fakeSystem({ present: [PLIST] }));

    expect(code).toBe(0);
    expect(calls).toEqual([`remove ${PLIST}`]);
  });

  it("fails loudly when the bundle cannot be removed", () => {
    const { code, err } = uninstallHarness(
      {},
      fakeSystem({ present: [APP], failing: "remove" }),
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("remove blew up");
  });
});

describe("install flag parsing", () => {
  it("treats citty's `--no-launch` negation of `launch` as no-launch", () => {
    expect(installOptionsFromArgs({ launch: false })).toEqual({
      force: false,
      noLaunch: true,
    });
  });

  it("launches by default and installs without --force by default", () => {
    expect(installOptionsFromArgs({ launch: true })).toEqual({
      force: false,
      noLaunch: false,
    });
    expect(installOptionsFromArgs({})).toEqual({ force: false, noLaunch: false });
  });

  it("passes --force through", () => {
    expect(installOptionsFromArgs({ force: true, launch: true }).force).toBe(true);
  });
});
