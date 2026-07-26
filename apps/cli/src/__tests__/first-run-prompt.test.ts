import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFirstRunPromptStore,
  decideFirstRunPrompt,
  maybeOfferBundledApp,
  offerAppInstall,
} from "../first-run-prompt.js";
import type { AppStatus } from "../app-status.js";

const MISSING: AppStatus = {
  install: "absent",
  installedVersion: null,
  installedPath: null,
  bundledVersion: "0.2.0",
  bundledReason: null,
  running: false,
  loginItem: false,
};

function inputs(overrides: Partial<Parameters<typeof decideFirstRunPrompt>[0]> = {}) {
  return {
    platform: "darwin",
    isTty: true,
    rawArgs: [] as string[],
    declined: false,
    status: MISSING,
    ...overrides,
  };
}

describe("first-run prompt decision", () => {
  it("offers to install when the app is missing on an interactive macOS terminal", () => {
    expect(decideFirstRunPrompt(inputs())).toEqual({
      prompt: true,
      kind: "missing",
      bundledVersion: "0.2.0",
    });
  });

  it("stays silent when stdout is not a TTY", () => {
    const decision = decideFirstRunPrompt(inputs({ isTty: false }));

    expect(decision).toEqual({ prompt: false, reason: "not-a-tty" });
  });

  it("stays silent for --json invocations even on a TTY", () => {
    for (const rawArgs of [["--json"], ["status", "--json"], ["today", "--json=1"]]) {
      expect(decideFirstRunPrompt(inputs({ rawArgs }))).toEqual({
        prompt: false,
        reason: "json-invocation",
      });
    }
  });

  it("stays silent when the installed app is already up to date", () => {
    const status: AppStatus = {
      ...MISSING,
      install: "current",
      installedVersion: "0.2.0",
      installedPath: "/Users/x/Applications/pmdr.app",
    };

    expect(decideFirstRunPrompt(inputs({ status }))).toEqual({
      prompt: false,
      reason: "up-to-date",
    });
  });

  it("offers to update when the installed app is older than the bundled one", () => {
    const status: AppStatus = {
      ...MISSING,
      install: "stale",
      installedVersion: "0.1.0",
      installedPath: "/Users/x/Applications/pmdr.app",
    };

    expect(decideFirstRunPrompt(inputs({ status }))).toEqual({
      prompt: true,
      kind: "stale",
      bundledVersion: "0.2.0",
    });
  });

  it("stays silent when this install carries no bundled app to offer", () => {
    const status: AppStatus = {
      ...MISSING,
      bundledVersion: null,
      bundledReason: "no bundled app zip in this install",
    };

    expect(decideFirstRunPrompt(inputs({ status }))).toEqual({
      prompt: false,
      reason: "no-bundled-app",
    });
  });

  it("never asks again once the offer has been declined", () => {
    expect(decideFirstRunPrompt(inputs({ declined: true }))).toEqual({
      prompt: false,
      reason: "declined",
    });
  });

  it("stays silent off macOS", () => {
    expect(decideFirstRunPrompt(inputs({ platform: "linux" }))).toEqual({
      prompt: false,
      reason: "not-macos",
    });
  });
});

describe("first-run prompt decline memory", () => {
  const freshDir = () => mkdtempSync(join(tmpdir(), "pmdr-prompt-"));

  it("reports nothing declined before the offer has been made", () => {
    expect(createFirstRunPromptStore(freshDir()).hasDeclined()).toBe(false);
  });

  it("remembers a decline across CLI runs", () => {
    const configDir = freshDir();

    createFirstRunPromptStore(configDir).recordDecline("0.2.0");

    expect(createFirstRunPromptStore(configDir).hasDeclined()).toBe(true);
  });

  it("treats a corrupt marker as declined rather than re-prompting forever", () => {
    const configDir = freshDir();
    writeFileSync(join(configDir, "app-prompt.json"), "{not json", "utf8");

    expect(createFirstRunPromptStore(configDir).hasDeclined()).toBe(true);
  });
});

const OFFER = {
  prompt: true as const,
  kind: "missing" as const,
  bundledVersion: "0.2.0",
};

describe("offering the install", () => {
  function harness(overrides: { confirm?: () => Promise<"yes" | "no" | "cancelled">; installCode?: number } = {}) {
    const calls: string[] = [];

    const deps = {
      confirm: async (message: string) => {
        calls.push(`confirm: ${message}`);
        return overrides.confirm ? overrides.confirm() : "yes" as const;
      },
      install: () => {
        calls.push("install");
        return overrides.installCode ?? 0;
      },
      recordDecline: () => {
        calls.push("recordDecline");
      },
      stdout: (line: string) => calls.push(`stdout: ${line}`),
    };

    return { calls, deps };
  }

  it("does nothing at all when the decision is to stay silent", async () => {
    const { calls, deps } = harness();

    const outcome = await offerAppInstall(
      { prompt: false, reason: "not-a-tty" },
      deps,
    );

    expect(outcome).toEqual({ action: "skipped", reason: "not-a-tty" });
    expect(calls).toEqual([]);
  });

  it("installs when accepted, and does not remember anything", async () => {
    const { calls, deps } = harness();

    const outcome = await offerAppInstall(OFFER, deps);

    expect(outcome).toEqual({ action: "installed" });
    expect(calls).toEqual([
      "confirm: Install the pmdr menubar app (0.2.0) and launch it?",
      "install",
    ]);
  });

  it("remembers a decline and says how to change your mind", async () => {
    const { calls, deps } = harness({ confirm: async () => "no" });

    const outcome = await offerAppInstall(OFFER, deps);

    expect(outcome).toEqual({ action: "declined" });
    expect(calls).toContain("recordDecline");
    expect(calls).not.toContain("install");
    expect(calls.at(-1)).toContain("pmdr app install");
  });

  it("treats a cancelled prompt as 'not now' — neither installed nor remembered", async () => {
    const { calls, deps } = harness({ confirm: async () => "cancelled" });

    const outcome = await offerAppInstall(OFFER, deps);

    expect(outcome).toEqual({ action: "cancelled" });
    expect(calls).not.toContain("recordDecline");
    expect(calls).not.toContain("install");
  });

  it("reports a failed install without remembering a decline", async () => {
    const { calls, deps } = harness({ installCode: 1 });

    const outcome = await offerAppInstall(OFFER, deps);

    expect(outcome).toEqual({ action: "install-failed", code: 1 });
    expect(calls).not.toContain("recordDecline");
  });

  it("frames the offer as an update when the installed app is stale", async () => {
    const { calls, deps } = harness();

    await offerAppInstall(
      { prompt: true, kind: "stale", bundledVersion: "0.2.0" },
      deps,
    );

    expect(calls[0]).toBe(
      "confirm: A newer menubar app (0.2.0) ships with this CLI. Update and launch it?",
    );
  });
});

describe("the wiring a plain `pmdr` run uses", () => {
  it("returns without prompting when stdout is not a TTY", async () => {
    // vitest runs with a piped stdout, so this exercises the real gate against
    // the real config dir and bundled-app locator: it must not hang or throw.
    await expect(maybeOfferBundledApp([])).resolves.toEqual({
      action: "skipped",
      reason: process.platform === "darwin" ? "not-a-tty" : "not-macos",
    });
  });
});
