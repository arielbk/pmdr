import { describe, expect, it } from "vitest";
import { renderAppStatus } from "../app-status.js";
import { createMenubarApp, reportOutcome } from "../menubar-app.js";
import type { MenubarAppOutcome } from "../menubar-app.js";
import type { MenubarAppSystem } from "../menubar-app-system.js";

const HOME = "/Users/x";
const APP = "/Users/x/Applications/pmdr.app";
const PLIST = "/Users/x/Library/LaunchAgents/dev.pmdr.menubar.plist";
const ZIP = "/pkg/bundled-app/pmdr-app.zip";

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
    replaceBundle: ({ zipPath, appPath, beforeSwap }) => {
      record("replaceBundle", `replace ${zipPath} -> ${appPath}`);
      beforeSwap();
      present.add(appPath);
    },
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

interface WorldOptions {
  bundledVersion?: string | null;
  installedVersion?: string | null;
  running?: boolean;
  loginItem?: boolean;
}

function menubarApp(world: WorldOptions = {}, fake = fakeSystem()) {
  const bundledVersion = world.bundledVersion ?? null;
  // `?? null` would swallow an explicit null, which is the "not installed" case.
  const installedVersion =
    "installedVersion" in world ? (world.installedVersion ?? null) : null;

  const app = createMenubarApp({
    home: HOME,
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
      probeRunning: () => world.running ?? false,
      probeLoginItem: () => world.loginItem ?? false,
    },
    system: fake.system,
  });

  return { app, ...fake };
}

/** What the command would have printed, which is the whole caller-facing story. */
function report(outcome: MenubarAppOutcome) {
  const { stdout, stderr, code } = reportOutcome(outcome);
  return { out: stdout.join("\n"), err: stderr.join("\n"), code };
}

describe("installing the menubar app", () => {
  it("refuses without touching anything when this CLI carries no app", () => {
    const { app, calls } = menubarApp({ bundledVersion: null });

    const { code, err } = report(app.install());

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toContain("no bundled app zip in this install");
  });

  it("is a no-op when the installed app is already the bundled version", () => {
    const { app, calls } = menubarApp({
      bundledVersion: "0.5.0",
      installedVersion: "0.5.0",
    });

    const { code, out } = report(app.install());

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out).toContain("already installed");
  });

  it("reinstalls the same version anyway under --force", () => {
    const { app, calls } = menubarApp({
      bundledVersion: "0.5.0",
      installedVersion: "0.5.0",
    });

    expect(app.install({ force: true }).kind).toBe("installed");
    expect(calls).not.toEqual([]);
  });

  it("replaces the bundle, quitting the running app as part of the swap", () => {
    const { app, calls } = menubarApp(
      { bundledVersion: "0.5.0", installedVersion: "0.4.1", running: true },
      fakeSystem({ present: [APP] }),
    );

    const { code, out } = report(app.install());

    expect(code).toBe(0);
    expect(calls).toEqual([`replace ${ZIP} -> ${APP}`, "quit", `launch ${APP}`]);
    expect(out).toContain("0.5.0");
  });

  it("does not quit anything when the app is not running", () => {
    const { app, calls } = menubarApp({ bundledVersion: "0.5.0" });

    app.install();

    expect(calls).not.toContain("quit");
  });

  it("leaves the app unlaunched when asked not to launch it", () => {
    const { app, calls } = menubarApp({ bundledVersion: "0.5.0" });

    expect(app.install({ launch: false }).kind).toBe("installed");
    expect(calls.some((call) => call.startsWith("launch"))).toBe(false);
  });

  it("fails without killing the running app when the replacement cannot be put in place", () => {
    const { app, calls } = menubarApp(
      { bundledVersion: "0.5.0", installedVersion: "0.4.1", running: true },
      fakeSystem({ present: [APP], failing: "replaceBundle" }),
    );

    const { code, err } = report(app.install());

    expect(code).toBe(1);
    expect(err).toContain("replaceBundle blew up");
    // The whole point of the beforeSwap hook: a failed replace never quits.
    expect(calls).toEqual([`replace ${ZIP} -> ${APP}`]);
  });

  it("says the app installed but could not launch, without a stack trace", () => {
    const { app } = menubarApp(
      { bundledVersion: "0.5.0" },
      fakeSystem({ failing: "launchApp" }),
    );

    const { code, out, err } = report(app.install());

    expect(out).toContain("0.5.0 installed");
    expect(err).toContain("installed but could not be launched");
    expect(err).toContain("launchApp blew up");
    expect(code).toBe(1);
  });
});

describe("uninstalling the menubar app", () => {
  it("quits the app, removes the bundle and removes the login item", () => {
    const { app, calls } = menubarApp(
      { running: true },
      fakeSystem({ present: [APP, PLIST] }),
    );

    const { code, out } = report(app.uninstall());

    expect(code).toBe(0);
    expect(calls).toEqual(["quit", `remove ${APP}`, `remove ${PLIST}`]);
    expect(out).toContain(APP);
  });

  it("is a no-op that still succeeds when nothing is installed", () => {
    const { app, calls } = menubarApp();

    const { code, out } = report(app.uninstall());

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out).toContain("nothing to remove");
  });

  it("removes a leftover login item even when the bundle is already gone", () => {
    const { app, calls } = menubarApp({}, fakeSystem({ present: [PLIST] }));

    expect(app.uninstall().kind).toBe("removed");
    expect(calls).toEqual([`remove ${PLIST}`]);
  });

  it("fails loudly when the bundle cannot be removed", () => {
    const { app } = menubarApp(
      {},
      fakeSystem({ present: [APP], failing: "removePath" }),
    );

    const { code, err } = report(app.uninstall());

    expect(code).toBe(1);
    expect(err).toContain("removePath blew up");
  });
});

describe("the launch-at-login item", () => {
  it("writes the LaunchAgent plist pointing at the installed binary", () => {
    const { app, calls, written } = menubarApp({ installedVersion: "0.1.0" });

    const { code, out } = report(app.setLoginItem(true));

    expect(code).toBe(0);
    expect(calls).toEqual([`write ${PLIST}`]);
    expect(written.get(PLIST)).toContain(`${APP}/Contents/MacOS/pmdr`);
    expect(out).toContain("Launch at login: enabled");
  });

  it("refuses to enable when no app is installed, and writes nothing", () => {
    const { app, calls } = menubarApp({ installedVersion: null });

    const { code, err } = report(app.setLoginItem(true));

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toContain("pmdr app install");
  });

  it("removes the plist when disabled", () => {
    const { app, calls } = menubarApp(
      { installedVersion: "0.1.0" },
      fakeSystem({ present: [PLIST] }),
    );

    const { code, out } = report(app.setLoginItem(false));

    expect(code).toBe(0);
    expect(calls).toEqual([`remove ${PLIST}`]);
    expect(out).toContain("Launch at login: disabled");
  });

  it("succeeds without touching anything when it was never enabled", () => {
    const { app, calls } = menubarApp({ installedVersion: "0.1.0" });

    const { code, out } = report(app.setLoginItem(false));

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out).toContain("Launch at login: disabled");
  });

  it("still disables when the app itself has already been removed", () => {
    const { app, calls } = menubarApp(
      { installedVersion: null },
      fakeSystem({ present: [PLIST] }),
    );

    expect(app.setLoginItem(false).kind).toBe("login-item-set");
    expect(calls).toEqual([`remove ${PLIST}`]);
  });

  it("fails loudly when the plist cannot be written", () => {
    const { app } = menubarApp(
      { installedVersion: "0.1.0" },
      fakeSystem({ failing: "writeLoginItem" }),
    );

    const { code, err } = report(app.setLoginItem(true));

    expect(code).toBe(1);
    expect(err).toContain("writeLoginItem blew up");
  });

  it("fails loudly when the plist cannot be removed", () => {
    const { app } = menubarApp(
      { installedVersion: "0.1.0" },
      fakeSystem({ present: [PLIST], failing: "removePath" }),
    );

    const { code, err } = report(app.setLoginItem(false));

    expect(code).toBe(1);
    expect(err).toContain("removePath blew up");
  });
});

describe("reporting status", () => {
  it("emits one line of machine-readable JSON with --json", () => {
    const { app } = menubarApp({
      installedVersion: "0.4.1",
      bundledVersion: "0.5.0",
      running: true,
      loginItem: true,
    });

    expect(JSON.parse(renderAppStatus(app.status(), true))).toEqual({
      install: "stale",
      installedVersion: "0.4.1",
      installedPath: APP,
      bundledVersion: "0.5.0",
      bundledReason: null,
      running: true,
      loginItem: true,
    });
  });

  it("reports honestly with --json when nothing is installed", () => {
    const { app } = menubarApp({ bundledVersion: "0.5.0" });

    expect(JSON.parse(renderAppStatus(app.status(), true))).toMatchObject({
      install: "absent",
      installedVersion: null,
      running: false,
      loginItem: false,
    });
  });

  it("prints a human summary by default", () => {
    const { app } = menubarApp({
      installedVersion: "0.4.1",
      bundledVersion: "0.4.1",
    });

    expect(renderAppStatus(app.status(), false)).toContain("up to date");
  });
});

describe("the cheap install state a plain `pmdr` run asks for", () => {
  it("answers the version question without probing the running process", () => {
    const probed: string[] = [];
    const app = createMenubarApp({
      home: HOME,
      bundled: {
        locate: () => ({ present: true, zipPath: ZIP, version: "0.5.0" }),
      },
      probes: {
        probeInstalled: () => {
          probed.push("installed");
          return { present: true, appPath: APP, version: "0.4.1" };
        },
        probeRunning: () => {
          probed.push("running");
          return false;
        },
        probeLoginItem: () => {
          probed.push("loginItem");
          return false;
        },
      },
      system: fakeSystem().system,
    });

    expect(app.installState()).toEqual({
      install: "stale",
      installedVersion: "0.4.1",
      installedPath: APP,
      bundledVersion: "0.5.0",
      bundledReason: null,
    });
    // `pgrep` on every plain `pmdr` start is exactly what this avoids.
    expect(probed).toEqual(["installed"]);
  });
});
