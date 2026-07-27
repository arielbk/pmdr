import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSetupMarkerStore,
  isSetUp,
  SETUP_MARKER_FILE,
  type SetupEvidence,
} from "../setup-state.js";

function tempConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "pmdr-setup-"));
}

function evidence(overrides: Partial<SetupEvidence> = {}): SetupEvidence {
  return {
    hasMarker: false,
    hasConfig: false,
    hasProjects: false,
    hasSessionHistory: false,
    ...overrides,
  };
}

describe("setup marker store", () => {
  it("reports no marker on a fresh config dir", () => {
    const store = createSetupMarkerStore(tempConfigDir());

    expect(store.exists()).toBe(false);
    expect(store.read()).toBeNull();
  });

  it("round-trips a recorded marker", () => {
    const dir = tempConfigDir();
    const store = createSetupMarkerStore(dir);

    store.record({ completedAt: "2026-07-27T10:00:00.000Z", version: "0.3.0" });

    expect(store.exists()).toBe(true);
    expect(store.read()).toEqual({
      completedAt: "2026-07-27T10:00:00.000Z",
      version: "0.3.0",
    });
    expect(readFileSync(join(dir, SETUP_MARKER_FILE), "utf8")).toContain(
      "0.3.0",
    );
  });

  it("creates the config dir if it does not exist yet", () => {
    const dir = join(tempConfigDir(), "nested", "pmdr");
    const store = createSetupMarkerStore(dir);

    store.record({ completedAt: "2026-07-27T10:00:00.000Z", version: "0.3.0" });

    expect(store.exists()).toBe(true);
  });

  it("counts a corrupt marker as set up rather than looping onboarding", () => {
    const dir = tempConfigDir();
    writeFileSync(join(dir, SETUP_MARKER_FILE), "{ not json", "utf8");
    const store = createSetupMarkerStore(dir);

    // `read` cannot describe it, but `exists` — what routing asks — still says
    // yes, so a mangled file never traps anyone in setup.
    expect(store.read()).toBeNull();
    expect(store.exists()).toBe(true);
  });
});

describe("isSetUp", () => {
  it("is false only when there is no trace of pmdr having been used", () => {
    expect(isSetUp(evidence())).toBe(false);
  });

  it("is true once setup has been completed", () => {
    expect(isSetUp(evidence({ hasMarker: true }))).toBe(true);
  });

  it.each([
    ["a config file", { hasConfig: true }],
    ["existing projects", { hasProjects: true }],
    ["session history", { hasSessionHistory: true }],
  ])(
    "treats %s as already set up, so upgrades never re-onboard",
    (_label, e) => {
      expect(isSetUp(evidence(e))).toBe(true);
    },
  );
});
