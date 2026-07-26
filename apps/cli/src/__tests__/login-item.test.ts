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
import { loginActionFromArgs, loginItemPlist } from "../login-item.js";
import { createMenubarApp } from "../menubar-app.js";

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

describe("login flag parsing", () => {
  it("reads --enable and --disable as the two actions", () => {
    expect(loginActionFromArgs({ enable: true })).toEqual({ enabled: true });
    expect(loginActionFromArgs({ disable: true })).toEqual({ enabled: false });
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
    const app = createMenubarApp({ home, probes });

    expect(probes.probeLoginItem()).toBe(false);

    expect(app.setLoginItem(true).kind).toBe("login-item-set");
    expect(probes.probeLoginItem()).toBe(true);
    expect(readFileSync(loginItemPlistPath(home), "utf8")).toContain(
      appBinaryPath(appPath),
    );

    expect(app.setLoginItem(false).kind).toBe("login-item-set");
    expect(probes.probeLoginItem()).toBe(false);
  });
});
