import { describe, expect, it } from "vitest";
import { deriveAppStatus, formatAppStatus } from "../app-status.js";

const absentBundle = {
  present: false as const,
  reason: "no bundled app zip in this install",
};
const bundled = (version: string) => ({
  present: true as const,
  zipPath: "/pkg/bundled-app/pmdr-app.zip",
  version,
});
const installed = (version: string) => ({
  present: true as const,
  appPath: "/Users/x/Applications/pmdr.app",
  version,
});
const notInstalled = { present: false as const };

describe("app status deriver", () => {
  it("reports an honest picture when nothing is installed and nothing is bundled", () => {
    expect(
      deriveAppStatus({
        bundled: absentBundle,
        installed: notInstalled,
        running: false,
        loginItem: false,
      }),
    ).toEqual({
      install: "absent",
      installedVersion: null,
      installedPath: null,
      bundledVersion: null,
      bundledReason: "no bundled app zip in this install",
      running: false,
      loginItem: false,
    });
  });

  it("is current when the installed app matches the bundled one", () => {
    expect(
      deriveAppStatus({
        bundled: bundled("0.4.1"),
        installed: installed("0.4.1"),
        running: true,
        loginItem: true,
      }),
    ).toEqual({
      install: "current",
      installedVersion: "0.4.1",
      installedPath: "/Users/x/Applications/pmdr.app",
      bundledVersion: "0.4.1",
      bundledReason: null,
      running: true,
      loginItem: true,
    });
  });

  it("is stale when the bundled app is newer than the installed one", () => {
    const status = deriveAppStatus({
      bundled: bundled("0.5.0"),
      installed: installed("0.4.10"),
      running: false,
      loginItem: false,
    });

    expect(status.install).toBe("stale");
    expect(status.installedVersion).toBe("0.4.10");
    expect(status.bundledVersion).toBe("0.5.0");
  });

  it("compares versions numerically rather than lexically", () => {
    expect(
      deriveAppStatus({
        bundled: bundled("0.4.9"),
        installed: installed("0.4.10"),
        running: false,
        loginItem: false,
      }).install,
    ).toBe("current");
  });

  it("cannot judge freshness when the CLI carries no bundled app", () => {
    const status = deriveAppStatus({
      bundled: absentBundle,
      installed: installed("0.4.1"),
      running: true,
      loginItem: false,
    });

    expect(status).toEqual({
      install: "unknown",
      installedVersion: "0.4.1",
      installedPath: "/Users/x/Applications/pmdr.app",
      bundledVersion: null,
      bundledReason: "no bundled app zip in this install",
      running: true,
      loginItem: false,
    });
  });
});

describe("app status human summary", () => {
  it("tells an uninstalled user what is available and how to get it", () => {
    const text = formatAppStatus(
      deriveAppStatus({
        bundled: bundled("0.4.1"),
        installed: notInstalled,
        running: false,
        loginItem: false,
      }),
    );

    expect(text).toContain("not installed");
    expect(text).toContain("0.4.1");
    expect(text).toContain("pmdr app install");
    expect(text).toContain("Running: no");
    expect(text).toContain("Launch at login: off");
  });

  it("says an up-to-date install is up to date", () => {
    const text = formatAppStatus(
      deriveAppStatus({
        bundled: bundled("0.4.1"),
        installed: installed("0.4.1"),
        running: true,
        loginItem: true,
      }),
    );

    expect(text).toContain("0.4.1");
    expect(text).toContain("up to date");
    expect(text).toContain("Running: yes");
    expect(text).toContain("Launch at login: on");
  });

  it("nudges an update when the install is stale", () => {
    const text = formatAppStatus(
      deriveAppStatus({
        bundled: bundled("0.5.0"),
        installed: installed("0.4.1"),
        running: false,
        loginItem: false,
      }),
    );

    expect(text).toContain("0.4.1");
    expect(text).toContain("0.5.0");
    expect(text).toContain("pmdr app install");
  });

  it("explains itself when this CLI ships no app to compare against", () => {
    const text = formatAppStatus(
      deriveAppStatus({
        bundled: absentBundle,
        installed: installed("0.4.1"),
        running: false,
        loginItem: false,
      }),
    );

    expect(text).toContain("0.4.1");
    expect(text).toContain("no bundled app zip in this install");
  });
});
