import { describe, expect, it } from "vitest";
import {
  runSetup,
  summaryLines,
  type Answer,
  type SetupDeps,
} from "../commands/setup.js";
import type { AppInstallState } from "../app-status.js";
import type { ProjectRecord } from "../projects.js";

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

function project(name: string): ProjectRecord {
  return { name, archived: false, createdAt: "2026-07-01T00:00:00.000Z" };
}

interface Harness {
  deps: SetupDeps;
  out: string[];
  err: string[];
  asked: string[];
  installs: number;
  loginItems: boolean[];
  markers: number;
  appDeclines: number;
  upserted: string[];
  lastProjects: string[];
}

function harness(
  overrides: Partial<SetupDeps> & {
    confirmAnswers?: Answer[];
    textAnswers?: Array<string | null>;
    selectAnswers?: Array<string | null>;
    projects?: ProjectRecord[];
    installCode?: number;
  } = {},
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const upserted: string[] = [];
  const lastProjects: string[] = [];
  const loginItems: boolean[] = [];
  const confirmAnswers = [...(overrides.confirmAnswers ?? [])];
  const textAnswers = [...(overrides.textAnswers ?? [])];
  const selectAnswers = [...(overrides.selectAnswers ?? [])];
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
    async askText(message) {
      asked.push(message);
      return textAnswers.length > 0
        ? (textAnswers.shift() as string | null)
        : "";
    },
    async askSelect(message) {
      asked.push(message);
      return selectAnswers.length > 0
        ? (selectAnswers.shift() as string | null)
        : null;
    },
    listProjects: () => overrides.projects ?? [],
    upsertProject: (name) => {
      upserted.push(name);
      return project(name);
    },
    writeLastProject: (name) => lastProjects.push(name),
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
    upserted,
    lastProjects,
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
  for (const key of [
    "confirmAnswers",
    "textAnswers",
    "selectAnswers",
    "projects",
    "installCode",
  ]) {
    delete copy[key];
  }
  return copy as Partial<SetupDeps>;
}

describe("pmdr setup", () => {
  it("creates the named project and makes it the one the next start uses", async () => {
    const h = harness({
      textAnswers: ["pmdr"],
      confirmAnswers: ["yes", "yes"],
    });

    const result = await runSetup(h.deps);

    expect(result).toEqual({
      status: "completed",
      project: "pmdr",
      app: "installed",
      loginItem: true,
    });
    expect(h.upserted).toEqual(["pmdr"]);
    expect(h.lastProjects).toEqual(["pmdr"]);
  });

  it("asks for a name directly when there are no projects yet", async () => {
    const h = harness({ textAnswers: ["pmdr"], confirmAnswers: ["no"] });

    await runSetup(h.deps);

    // No list to choose from, so the select is never shown.
    expect(h.asked[0]).toContain("blank to skip");
  });

  it("offers existing projects as a list", async () => {
    const h = harness({
      projects: [project("pmdr"), project("infinum")],
      selectAnswers: ["infinum"],
      confirmAnswers: ["no"],
    });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ project: "infinum" });
    expect(h.upserted).toEqual(["infinum"]);
  });

  it("asks for a name after picking new… from the list", async () => {
    const h = harness({
      projects: [project("pmdr")],
      selectAnswers: ["__new__"],
      textAnswers: ["side-quest"],
      confirmAnswers: ["no"],
    });

    expect(await runSetup(h.deps)).toMatchObject({ project: "side-quest" });
  });

  it("leaves sessions unassigned when the project step is skipped", async () => {
    const h = harness({ textAnswers: ["  "], confirmAnswers: ["no"] });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ project: null });
    expect(h.upserted).toEqual([]);
    expect(h.lastProjects).toEqual([]);
  });

  it("refuses the reserved project name instead of creating it", async () => {
    const h = harness({
      textAnswers: ["(unassigned)"],
      confirmAnswers: ["no"],
    });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ project: null });
    expect(h.upserted).toEqual([]);
    expect(h.err.join("\n")).toContain("reserved");
  });

  it("installs the app and enables the login item when both are accepted", async () => {
    const h = harness({ textAnswers: [""], confirmAnswers: ["yes", "yes"] });

    await runSetup(h.deps);

    expect(h.installs).toBe(1);
    expect(h.loginItems).toEqual([true]);
  });

  it("remembers a declined app so the next bare `pmdr` does not re-ask", async () => {
    const h = harness({ textAnswers: [""], confirmAnswers: ["no"] });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ app: "declined", loginItem: false });
    expect(h.installs).toBe(0);
    expect(h.appDeclines).toBe(1);
    expect(h.out.join("\n")).toContain("pmdr app install");
  });

  it("does not offer to install an app that is already current", async () => {
    const h = harness({
      textAnswers: [""],
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
      textAnswers: [""],
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

  it("says nothing about the app off macOS", async () => {
    const h = harness({ textAnswers: [""], platform: "linux" });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ app: "unavailable" });
    expect(h.asked.some((q) => q.toLowerCase().includes("app"))).toBe(false);
    expect(h.installs).toBe(0);
  });

  it("says nothing about the app when this build has none bundled", async () => {
    const h = harness({
      textAnswers: [""],
      appInstallState: () => NO_BUNDLED_APP,
    });

    expect(await runSetup(h.deps)).toMatchObject({ app: "unavailable" });
    expect(h.asked.some((q) => q.toLowerCase().includes("install"))).toBe(
      false,
    );
  });

  it("still records setup when the install fails, and says what to retry", async () => {
    const h = harness({
      textAnswers: ["pmdr"],
      confirmAnswers: ["yes"],
      installCode: 1,
    });

    const result = await runSetup(h.deps);

    expect(result).toMatchObject({ app: "failed", loginItem: false });
    expect(h.markers).toBe(1);
    expect(h.err.join("\n")).toContain("pmdr app install: boom");
    expect(h.out.join("\n")).toContain("retry with `pmdr app install`");
    // A failed install is not a reason to ask about launching at login.
    expect(h.loginItems).toEqual([]);
  });

  it("records the marker exactly once on a completed run", async () => {
    const h = harness({ textAnswers: ["pmdr"], confirmAnswers: ["yes", "no"] });

    await runSetup(h.deps);

    expect(h.markers).toBe(1);
  });

  it.each([
    ["the project name", { textAnswers: [null] as Array<string | null> }],
    [
      "the project list",
      {
        projects: [project("pmdr")],
        selectAnswers: [null] as Array<string | null>,
      },
    ],
    [
      "the install offer",
      { textAnswers: [""], confirmAnswers: ["cancelled"] as Answer[] },
    ],
    [
      "the login offer",
      { textAnswers: [""], confirmAnswers: ["yes", "cancelled"] as Answer[] },
    ],
  ])("writes no marker when cancelled at %s", async (_label, overrides) => {
    const h = harness(overrides);

    expect(await runSetup(h.deps)).toEqual({ status: "cancelled" });
    expect(h.markers).toBe(0);
  });
});

describe("setup summary", () => {
  it("names the project it set up", () => {
    expect(
      summaryLines({ project: "pmdr", app: "installed", loginItem: true }),
    ).toContain("  pmdr           start a pomodoro for pmdr");
  });

  it("drops the project from the summary when none was chosen", () => {
    expect(
      summaryLines({ project: null, app: "declined", loginItem: false }),
    ).toContain("  pmdr           start a pomodoro");
  });

  it("points at the other commands worth knowing", () => {
    const lines = summaryLines({
      project: "pmdr",
      app: "installed",
      loginItem: true,
    }).join("\n");

    expect(lines).toContain("pmdr status");
    expect(lines).toContain("pmdr today");
    expect(lines).toContain("pmdr config");
  });
});
