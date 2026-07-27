import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideBareRoute, type BareRouteInputs } from "../bare-route.js";
import { gatherSetupEvidence } from "../bare-command.js";
import { SETUP_MARKER_FILE } from "../setup-state.js";

function inputs(overrides: Partial<BareRouteInputs> = {}): BareRouteInputs {
  return { setUp: true, isTty: true, session: "idle", ...overrides };
}

describe("bare `pmdr` routing", () => {
  it("onboards on a fresh install", () => {
    expect(decideBareRoute(inputs({ setUp: false }))).toBe("setup");
  });

  it("starts a pomodoro when set up and idle", () => {
    expect(decideBareRoute(inputs())).toBe("start");
  });

  it.each(["running", "paused"] as const)(
    "attaches to a %s session instead of failing to start on top of it",
    (session) => {
      expect(decideBareRoute(inputs({ session }))).toBe("attach");
    },
  );

  it("starts rather than attaching once the session has expired", () => {
    // The caller advances expired phases before deriving, so an "expired" kind
    // here is a session with nothing left to attach to.
    expect(decideBareRoute(inputs({ session: "expired" }))).toBe("start");
  });

  it("skips onboarding without a TTY, because prompts would hang a script", () => {
    expect(decideBareRoute(inputs({ setUp: false, isTty: false }))).toBe(
      "start",
    );
  });

  it("still attaches without a TTY", () => {
    expect(
      decideBareRoute(
        inputs({ setUp: false, isTty: false, session: "running" }),
      ),
    ).toBe("attach");
  });
});

describe("gatherSetupEvidence", () => {
  function dirs() {
    const root = mkdtempSync(join(tmpdir(), "pmdr-evidence-"));
    const stateDir = join(root, "state");
    const configDir = join(root, "config");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    return { stateDir, configDir };
  }

  it("finds nothing on an empty install", () => {
    const { stateDir, configDir } = dirs();

    expect(gatherSetupEvidence(stateDir, configDir)).toEqual({
      hasMarker: false,
      hasConfig: false,
      hasProjects: false,
      hasSessionHistory: false,
    });
  });

  it("sees a recorded setup marker", () => {
    const { stateDir, configDir } = dirs();
    writeFileSync(
      join(configDir, SETUP_MARKER_FILE),
      '{"completedAt":"2026-07-27T10:00:00.000Z","version":"0.3.0"}',
      "utf8",
    );

    expect(gatherSetupEvidence(stateDir, configDir).hasMarker).toBe(true);
  });

  it("sees a config file", () => {
    const { stateDir, configDir } = dirs();
    writeFileSync(
      join(configDir, "config.json"),
      '{"focusMinutes":30}',
      "utf8",
    );

    expect(gatherSetupEvidence(stateDir, configDir).hasConfig).toBe(true);
  });

  it("sees existing projects", () => {
    const { stateDir, configDir } = dirs();
    writeFileSync(
      join(stateDir, "projects.json"),
      '{"projects":[{"name":"pmdr","archived":false,"createdAt":"2026-07-01T00:00:00.000Z"}]}',
      "utf8",
    );

    expect(gatherSetupEvidence(stateDir, configDir).hasProjects).toBe(true);
  });

  it("does not count an empty projects file as a project", () => {
    const { stateDir, configDir } = dirs();
    writeFileSync(join(stateDir, "projects.json"), '{"projects":[]}', "utf8");

    expect(gatherSetupEvidence(stateDir, configDir).hasProjects).toBe(false);
  });

  it.each(["state.json", "completions.jsonl"])(
    "counts %s as session history",
    (file) => {
      const { stateDir, configDir } = dirs();
      writeFileSync(join(stateDir, file), "", "utf8");

      expect(gatherSetupEvidence(stateDir, configDir).hasSessionHistory).toBe(
        true,
      );
    },
  );
});
