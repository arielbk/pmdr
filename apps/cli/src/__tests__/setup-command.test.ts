import { describe, expect, it } from "vitest";
import {
  runSetup,
  summaryLines,
  type Answer,
  type SetupDeps,
} from "../commands/setup.js";
import type { AppInstallState } from "../app-status.js";

const APP_ABSENT: AppInstallState = {
  install: "absent",
  installedVersion: null,
  installedPath: null,
  bundledVersion: "0.3.0",
  bundledReason: null,
};

const APP_CURRENT: AppInstallState = {
  install: "current",
  installedVersion: "0.3.0",
  installedPath: "/Users/x/Applications/pmdr.app",
  bundledVersion: "0.3.0",
  bundledReason: null,
};

const NO_BUNDLED_APP: AppInstallState = {
  install: "absent",
  installedVersion: null,
  installedPath: null,
  bundledVersion: null,
  bundledReason: "no bundled app in this build",
};

interface Harness {
  deps: SetupDeps;
  out: string[];
  err: string[];
  asked: string[];
  installs: number;
  loginItems: boolean[];
  markers: number;
  appDeclines: number;
}

function harness(
  overrides: Partial<SetupDeps> & {
    confirmAnswers?: Answer[];
    installCode?: number;
  } = {},
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const loginItems: boolean[] = [];
  const confirmAnswers = [...(overrides.confirmAnswers ?? [])];
  const state = {
    installs: 0,
    markers: 0,
    appDeclines: 0,
  };

  const deps: SetupDeps = {
    platform: "darwin",
    version: "0.3.0",
    async confirm(message) {
      asked.push(message);
      return confirmAnswers.shift() ?? "no";
    },
    appInstallState: () => APP_ABSENT,
    installApp: () => {
      state.installs += 1;
      const code = overrides.installCode ?? 0;
      return code === 0
        ? {
            stdout: ["App: 0.3.0 installed at /Users/x/Applications/pmdr.app"],
            stderr: [],
            code,
          }
        : { stdout: [], stderr: ["pmdr app install: boom"], code };
    },
    setLoginItem: (enabled) => {
      loginItems.push(enabled);
      return {
        stdout: [`Launch at login: ${enabled ? "enabled" : "disabled"}`],
        stderr: [],
        code: 0,
      };
    },
    recordAppDecline: () => {
      state.appDeclines += 1;
    },
    recordMarker: () => {
      state.markers += 1;
    },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    ...stripHarnessKeys(overrides),
  };

  return {
    deps,
    out,
    err,
    asked,
    loginItems,
    get installs() {
      return state.installs;
    },
    get markers() {
      return state.markers;
    },
    get appDeclines() {
      return state.appDeclines;
    },
  };
}

/** Keeps the harness-only knobs out of the `SetupDeps` spread. */
function stripHarnessKeys(
  overrides: Record<string, unknown>,
): Partial<SetupDeps> {
  const copy = { ...overrides };
  for (const key of ["confirmAnswers", "installCode"]) {
    delete copy[key];
  }
  return copy as Partial<SetupDeps>;
}

describe("pmdr setup", () => {
  it("installs the app and enables the login item when both are accepted", async () => {
    const h = harness({ confirmAnswers: ["yes", "yes"] });

    const result = await runSetup(h.deps);

    expect(result).toEqual({
      status: "completed",
      app: "installed",
      loginItem: true,
    });
    expect(h.installs).toBe(1);
    expect(h.loginItems).toEqual([true]);
  });

  it("asks about nothing but the app", async () => {
    const h = harness({ confirmAnswers: ["yes", "yes"] });

    await runSetup(h.deps);

    // The whole command is the menubar app: nothing else gets a question.
    expect(h.asked).toEqual([
      "Install the pmdr menubar app (0.3.0) and launch it?",
      "Launch the menubar app at login?",
    ]);
  });

  it("remembers a declined app so the next bare `pmdr` does not re-ask", async () => {
    const h = harness({ confirmAnswers: ["no"] });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ app: "declined", loginItem: false });
    expect(h.installs).toBe(0);
    expect(h.appDeclines).toBe(1);
    expect(h.out.join("\n")).toContain("pmdr app install");
  });

  it("does not offer to install an app that is already current", async () => {
    const h = harness({
      confirmAnswers: ["yes"],
      appInstallState: () => APP_CURRENT,
    });

    const result = await runSetup(h.deps);

    expect(h.installs).toBe(0);
    expect(result).toMatchObject({ app: "already-installed", loginItem: true });
    // The only app question asked is the login one.
    expect(h.asked.filter((q) => q.includes("login"))).toHaveLength(1);
    expect(h.asked.some((q) => q.includes("Install"))).toBe(false);
  });

  it("offers an update when the installed app is older than the bundled one", async () => {
    const h = harness({
      confirmAnswers: ["yes", "no"],
      appInstallState: () => ({
        ...APP_CURRENT,
        install: "stale",
        installedVersion: "0.2.0",
      }),
    });

    await runSetup(h.deps);

    expect(
      h.asked.some((q) => q.startsWith("Update the menubar app to 0.3.0")),
    ).toBe(true);
    expect(h.installs).toBe(1);
  });

  it("asks nothing off macOS, and says why", async () => {
    const h = harness({ platform: "linux" });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ app: "unavailable" });
    expect(h.asked).toEqual([]);
    expect(h.installs).toBe(0);
    expect(h.out.join("\n")).toContain("macOS only");
  });

  it("asks nothing when this build has none bundled, and says why", async () => {
    const h = harness({ appInstallState: () => NO_BUNDLED_APP });

    expect(await runSetup(h.deps)).toMatchObject({ app: "unavailable" });
    expect(h.asked).toEqual([]);
    expect(h.out.join("\n")).toContain("no bundled app in this build");
  });

  it("still records setup when the install fails, and says what to retry", async () => {
    const h = harness({ confirmAnswers: ["yes"], installCode: 1 });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ app: "failed", loginItem: false });
    expect(h.markers).toBe(1);
    expect(h.err.join("\n")).toContain("pmdr app install: boom");
    expect(h.out.join("\n")).toContain("retry with `pmdr app install`");
    // A failed install is not a reason to ask about launching at login.
    expect(h.loginItems).toEqual([]);
  });

  it("records the marker exactly once on a completed run", async () => {
    const h = harness({ confirmAnswers: ["yes", "no"] });

    await runSetup(h.deps);

    expect(h.markers).toBe(1);
  });

  it("records the marker even where the app cannot be installed at all", async () => {
    // Nothing was asked, but onboarding did happen — bare `pmdr` must not route
    // an off-macOS install back into setup on every single run.
    const h = harness({ platform: "linux" });

    await runSetup(h.deps);

    expect(h.markers).toBe(1);
  });

  it.each([
    ["the install offer", ["cancelled"] as Answer[]],
    ["the login offer", ["yes", "cancelled"] as Answer[]],
  ])(
    "writes no marker when cancelled at %s",
    async (_label, confirmAnswers) => {
      const h = harness({ confirmAnswers });

      expect(await runSetup(h.deps)).toEqual({ status: "cancelled" });
      expect(h.markers).toBe(0);
    },
  );
});

describe("setup summary", () => {
  it("points at the commands worth knowing", () => {
    const lines = summaryLines({ app: "installed", loginItem: true }).join(
      "\n",
    );

    expect(lines).toContain("pmdr status");
    expect(lines).toContain("pmdr today");
    expect(lines).toContain("pmdr project");
    expect(lines).toContain("pmdr config");
  });

  it("names the retry when the install failed", () => {
    const lines = summaryLines({ app: "failed", loginItem: false }).join("\n");

    expect(lines).toContain("pmdr app install");
  });
});
