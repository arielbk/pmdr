import { describe, expect, it } from "vitest";
import {
  appProcessPattern,
  createAppProbes,
  installedAppPath,
  loginItemPlistPath,
} from "../app-probes.js";

const HOME = "/Users/x";

describe("app probe locations", () => {
  it("looks for the app in the user's Applications directory", () => {
    expect(installedAppPath(HOME)).toBe("/Users/x/Applications/pmdr.app");
  });

  it("looks for the login item in the user's LaunchAgents directory", () => {
    expect(loginItemPlistPath(HOME)).toBe(
      "/Users/x/Library/LaunchAgents/dev.pmdr.menubar.plist",
    );
  });
});

describe("app process pattern", () => {
  it("targets the executable inside the bundle", () => {
    expect(appProcessPattern("/Users/x/Applications/pmdr.app")).toContain(
      "/Contents/MacOS",
    );
  });

  it("escapes regex metacharacters so the match is not looser than intended", () => {
    const pattern = appProcessPattern("/Users/x/Applications/pmdr.app");

    expect(pattern).toBe("/Users/x/Applications/pmdr\\.app/Contents/MacOS");
    expect(new RegExp(pattern).test("/Users/x/Applications/pmdrXapp/Contents/MacOS")).toBe(false);
    expect(new RegExp(pattern).test("/Users/x/Applications/pmdr.app/Contents/MacOS/pmdr")).toBe(true);
  });
});

describe("app probes", () => {
  it("reports the app absent when nothing is in Applications", () => {
    const probes = createAppProbes({
      home: HOME,
      exists: () => false,
      readAppVersion: () => null,
      processRunning: () => false,
    });

    expect(probes.probeInstalled()).toEqual({ present: false });
  });

  it("reports the installed app's path and version when it is there", () => {
    const probes = createAppProbes({
      home: HOME,
      exists: (p) => p === installedAppPath(HOME),
      readAppVersion: () => "0.4.1",
      processRunning: () => false,
    });

    expect(probes.probeInstalled()).toEqual({
      present: true,
      appPath: "/Users/x/Applications/pmdr.app",
      version: "0.4.1",
    });
  });

  it("treats an unreadable bundle as not installed rather than throwing", () => {
    const probes = createAppProbes({
      home: HOME,
      exists: () => true,
      readAppVersion: () => null,
      processRunning: () => false,
    });

    expect(probes.probeInstalled()).toEqual({ present: false });
  });

  it("asks whether a process is running out of the installed bundle", () => {
    const asked: string[] = [];
    const probes = createAppProbes({
      home: HOME,
      exists: () => true,
      readAppVersion: () => "0.4.1",
      processRunning: (p) => {
        asked.push(p);
        return true;
      },
    });

    expect(probes.probeRunning()).toBe(true);
    expect(asked).toEqual(["/Users/x/Applications/pmdr.app"]);
  });

  it("reads the login item state from the LaunchAgent plist's presence", () => {
    const withPlist = createAppProbes({
      home: HOME,
      exists: (p) => p === loginItemPlistPath(HOME),
      readAppVersion: () => null,
      processRunning: () => false,
    });
    const withoutPlist = createAppProbes({
      home: HOME,
      exists: () => false,
      readAppVersion: () => null,
      processRunning: () => false,
    });

    expect(withPlist.probeLoginItem()).toBe(true);
    expect(withoutPlist.probeLoginItem()).toBe(false);
  });
});
