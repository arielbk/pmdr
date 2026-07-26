import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appBinaryPath,
  createAppProbes,
  installedAppPath,
  loginItemPlistPath,
} from "../app-probes.js";
import { loginActionFromArgs, loginItemPlist, runAppLogin } from "../login-item.js";
import { createMenubarAppSystem } from "../menubar-app-system.js";
import type { MenubarAppSystem } from "../menubar-app-system.js";

const HOME = "/Users/x";
const APP = "/Users/x/Applications/pmdr.app";
const PLIST = "/Users/x/Library/LaunchAgents/dev.pmdr.menubar.plist";

interface FakeOptions {
  present?: string[];
  failing?: keyof MenubarAppSystem;
}

/**
 * Records every side effect that actually happened, in order. A `removePath`
 * on something that was never there is not a side effect, so it is not logged.
 */
function fakeSystem(options: FakeOptions = {}) {
  const calls: string[] = [];
  const written = new Map<string, string>();
  const present = new Set(options.present ?? []);

  const record = (name: keyof MenubarAppSystem, detail: string): void => {
    calls.push(detail);
    if (options.failing === name) throw new Error(`${name} blew up`);
  };

  const system: MenubarAppSystem = {
    replaceBundle: ({ appPath }) => record("replaceBundle", `replace ${appPath}`),
    removePath: (path) => {
      if (!present.has(path)) return false;
      record("removePath", `remove ${path}`);
      present.delete(path);
      return true;
    },
    quitApp: () => record("quitApp", "quit"),
    launchApp: (path) => record("launchApp", `launch ${path}`),
    writeLoginItem: (path, content) => {
      record("writeLoginItem", `write ${path}`);
      written.set(path, content);
      present.add(path);
    },
  };

  return { system, calls, written, present };
}

function harness(
  overrides: {
    platform?: string;
    action?: "enable" | "disable";
    installedVersion?: string | null;
  } = {},
  fake = fakeSystem(),
) {
  const out: string[] = [];
  const err: string[] = [];
  // `?? "0.1.0"` would swallow an explicit `null`, which is the "not installed" case.
  const installedVersion: string | null =
    "installedVersion" in overrides ? (overrides.installedVersion ?? null) : "0.1.0";

  const code = runAppLogin({
    platform: overrides.platform ?? "darwin",
    home: HOME,
    action: overrides.action ?? "enable",
    probes: {
      probeInstalled: () =>
        installedVersion === null
          ? { present: false }
          : { present: true, appPath: APP, version: installedVersion },
    },
    system: fake.system,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });

  return { code, out, err, calls: fake.calls, written: fake.written };
}

const BINARY = "/Users/x/Applications/pmdr.app/Contents/MacOS/pmdr";

describe("login item plist", () => {
  it("labels the agent with the app's bundle id", () => {
    expect(loginItemPlist(BINARY)).toContain(
      "<key>Label</key>\n  <string>dev.pmdr.menubar</string>",
    );
  });

  it("invokes the installed app binary at load", () => {
    const plist = loginItemPlist(BINARY);

    expect(plist).toContain(
      `<key>ProgramArguments</key>\n  <array>\n    <string>${BINARY}</string>\n  </array>`,
    );
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  });

  it("is parseable by the system plist reader", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pmdr-plist-")), "agent.plist");
    writeFileSync(path, loginItemPlist(BINARY));

    const label = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :Label", path],
      { encoding: "utf8" },
    ).trim();

    expect(label).toBe("dev.pmdr.menubar");
  });
});

describe("pmdr app login --enable", () => {
  it("writes the LaunchAgent plist pointing at the installed binary", () => {
    const { code, out, calls, written } = harness();

    expect(code).toBe(0);
    expect(calls).toEqual([`write ${PLIST}`]);
    expect(written.get(PLIST)).toContain(`${APP}/Contents/MacOS/pmdr`);
    expect(out.join("\n")).toContain("Launch at login: enabled");
  });
});

describe("pmdr app login refusals", () => {
  it("refuses to enable when no app is installed, and writes nothing", () => {
    const { code, err, calls } = harness({ installedVersion: null });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("\n")).toContain("pmdr app install");
  });

  it("fails with one clear line on a non-macOS machine", () => {
    const { code, out, err, calls } = harness({ platform: "linux" });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(calls).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("macOS");
  });
});

describe("pmdr app login --disable", () => {
  it("removes the LaunchAgent plist", () => {
    const { code, out, calls } = harness(
      { action: "disable" },
      fakeSystem({ present: [PLIST] }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual([`remove ${PLIST}`]);
    expect(out.join("\n")).toContain("Launch at login: disabled");
  });

  it("succeeds without touching anything when it was never enabled", () => {
    const { code, out, calls } = harness({ action: "disable" });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out.join("\n")).toContain("Launch at login: disabled");
  });

  it("still disables when the app itself has already been removed", () => {
    const { code, calls } = harness(
      { action: "disable", installedVersion: null },
      fakeSystem({ present: [PLIST] }),
    );

    expect(code).toBe(0);
    expect(calls).toEqual([`remove ${PLIST}`]);
  });
});

describe("login flag parsing", () => {
  it("reads --enable and --disable as the two actions", () => {
    expect(loginActionFromArgs({ enable: true })).toEqual({ action: "enable" });
    expect(loginActionFromArgs({ disable: true })).toEqual({ action: "disable" });
  });

  it("rejects an invocation that asks for neither or both", () => {
    expect(loginActionFromArgs({})).toEqual({
      error: "pmdr app login: pass exactly one of --enable or --disable",
    });
    expect(loginActionFromArgs({ enable: true, disable: true })).toEqual({
      error: "pmdr app login: pass exactly one of --enable or --disable",
    });
  });
});

describe("pmdr app login failures", () => {
  it("fails loudly when the plist cannot be written", () => {
    const { code, err } = harness({}, fakeSystem({ failing: "writeLoginItem" }));

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("writeLoginItem blew up");
  });

  it("fails loudly when the plist cannot be removed", () => {
    const { code, err } = harness(
      { action: "disable" },
      fakeSystem({ present: [PLIST], failing: "removePath" }),
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("removePath blew up");
  });
});

describe("login item round-trip on a real filesystem", () => {
  it("shows up in app status once enabled, and goes away once disabled", () => {
    const home = mkdtempSync(join(tmpdir(), "pmdr-home-"));
    const appPath = installedAppPath(home);
    const probes = createAppProbes({
      home,
      readAppVersion: () => "0.1.0",
      processRunning: () => false,
    });
    mkdirSync(join(appPath, "Contents", "MacOS"), { recursive: true });
    const run = (action: "enable" | "disable") =>
      runAppLogin({
        platform: "darwin",
        home,
        action,
        probes,
        system: createMenubarAppSystem(home),
        stdout: () => {},
        stderr: () => {},
      });

    expect(probes.probeLoginItem()).toBe(false);
    expect(run("enable")).toBe(0);
    expect(probes.probeLoginItem()).toBe(true);
    expect(readFileSync(loginItemPlistPath(home), "utf8")).toContain(
      appBinaryPath(appPath),
    );

    expect(run("disable")).toBe(0);
    expect(probes.probeLoginItem()).toBe(false);
  });
});
