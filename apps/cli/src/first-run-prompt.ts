import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAppProbes } from "./app-probes.js";
import { createInstallSystem, runAppInstall } from "./app-install.js";
import { deriveAppStatus } from "./app-status.js";
import { createBundledAppModule } from "./bundled-app.js";
import { defaultConfigDir } from "./config.js";
import type { AppStatus } from "./app-status.js";

/** Where the decline is remembered, alongside `config.json` in the config dir. */
export const FIRST_RUN_PROMPT_FILE = "app-prompt.json";

/**
 * The decline is sticky rather than per-version: someone who said no once
 * should not be asked again on every app update. `pmdr app install` stays
 * available for anyone who changes their mind.
 */
export function createFirstRunPromptStore(configDir: string = defaultConfigDir()) {
  const file = join(configDir, FIRST_RUN_PROMPT_FILE);

  return {
    hasDeclined(): boolean {
      if (!existsSync(file)) return false;
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as {
          declinedVersion?: unknown;
        };
        return typeof parsed.declinedVersion === "string";
      } catch {
        // A corrupt marker must not turn into a recurring prompt.
        return true;
      }
    },

    recordDecline(bundledVersion: string): void {
      mkdirSync(configDir, { recursive: true });
      const tmpFile = `${file}.${process.pid}.tmp`;
      writeFileSync(
        tmpFile,
        `${JSON.stringify({ declinedVersion: bundledVersion }, null, 2)}\n`,
        "utf8",
      );
      renameSync(tmpFile, file);
    },
  };
}

export type FirstRunPromptDecision =
  | { prompt: true; kind: "missing" | "stale"; bundledVersion: string }
  | { prompt: false; reason: string };

export interface FirstRunPromptInputs {
  platform: string;
  isTty: boolean;
  rawArgs: string[];
  declined: boolean;
  status: AppStatus;
}

function isJsonFlag(arg: string): boolean {
  return arg === "--json" || arg.startsWith("--json=");
}

/**
 * Whether a plain `pmdr` run should offer to install the bundled menubar app.
 * Pure, because an ungated prompt is this feature's worst failure mode: it
 * would hang any agent or script that runs the CLI non-interactively.
 */
export function decideFirstRunPrompt(
  inputs: FirstRunPromptInputs,
): FirstRunPromptDecision {
  if (inputs.platform !== "darwin") return { prompt: false, reason: "not-macos" };
  if (!inputs.isTty) return { prompt: false, reason: "not-a-tty" };
  if (inputs.rawArgs.some(isJsonFlag)) {
    return { prompt: false, reason: "json-invocation" };
  }

  if (inputs.declined) return { prompt: false, reason: "declined" };

  const { install, bundledVersion } = inputs.status;
  if (bundledVersion === null) {
    return { prompt: false, reason: "no-bundled-app" };
  }
  if (install !== "absent" && install !== "stale") {
    return { prompt: false, reason: "up-to-date" };
  }

  return {
    prompt: true,
    kind: install === "stale" ? "stale" : "missing",
    bundledVersion: bundledVersion as string,
  };
}

export type ConfirmAnswer = "yes" | "no" | "cancelled";

export interface OfferAppInstallDeps {
  confirm(message: string): Promise<ConfirmAnswer>;
  install(): number;
  recordDecline(): void;
  stdout(line: string): void;
}

export type OfferOutcome =
  | { action: "skipped"; reason: string }
  | { action: "installed" }
  | { action: "install-failed"; code: number }
  | { action: "declined" }
  | { action: "cancelled" };

/**
 * Runs the offer described by `decision`. Never throws and never blocks unless
 * the decision itself said prompting is safe — a plain `pmdr` must still reach
 * its timer even if the install goes wrong.
 */
export async function offerAppInstall(
  decision: FirstRunPromptDecision,
  deps: OfferAppInstallDeps,
): Promise<OfferOutcome> {
  if (!decision.prompt) {
    return { action: "skipped", reason: decision.reason };
  }

  const answer = await deps.confirm(offerMessage(decision));
  if (answer === "cancelled") return { action: "cancelled" };
  if (answer === "no") {
    deps.recordDecline();
    deps.stdout(DECLINE_ACKNOWLEDGEMENT);
    return { action: "declined" };
  }

  const code = deps.install();
  return code === 0 ? { action: "installed" } : { action: "install-failed", code };
}

export const DECLINE_ACKNOWLEDGEMENT =
  "Not installing. Run `pmdr app install` any time you change your mind.";

export function offerMessage(
  decision: Extract<FirstRunPromptDecision, { prompt: true }>,
): string {
  return decision.kind === "stale"
    ? `A newer menubar app (${decision.bundledVersion}) ships with this CLI. Update and launch it?`
    : `Install the pmdr menubar app (${decision.bundledVersion}) and launch it?`;
}

/**
 * The real wiring behind a plain `pmdr` run: decide, maybe ask, maybe install.
 * Any failure here is swallowed — the offer is a courtesy, and it must never
 * stand between someone and their timer.
 */
export async function maybeOfferBundledApp(
  rawArgs: string[],
): Promise<OfferOutcome> {
  try {
    const home = homedir();
    const store = createFirstRunPromptStore();
    const bundled = createBundledAppModule();
    const probes = createAppProbes({ home });
    // Run state and the login item play no part in the decision, so they are
    // not probed here — that keeps a plain `pmdr` from shelling out to pgrep.
    const status = deriveAppStatus({
      bundled: bundled.locate(),
      installed: probes.probeInstalled(),
      running: false,
      loginItem: false,
    });

    const decision = decideFirstRunPrompt({
      platform: process.platform,
      isTty: process.stdout.isTTY === true && process.stdin.isTTY === true,
      rawArgs,
      declined: store.hasDeclined(),
      status,
    });

    return await offerAppInstall(decision, {
      confirm: async (message) => {
        const { confirm, isCancel } = await import("@clack/prompts");
        const answer = await confirm({ message });
        if (isCancel(answer)) return "cancelled";
        return answer ? "yes" : "no";
      },
      install: () =>
        runAppInstall({
          platform: process.platform,
          home,
          bundled,
          probes,
          system: createInstallSystem(home),
          stdout: (line) => console.log(line),
          stderr: (line) => console.error(line),
        }),
      recordDecline: () => store.recordDecline(status.bundledVersion ?? "unknown"),
      stdout: (line) => console.log(line),
    });
  } catch {
    return { action: "skipped", reason: "offer-failed" };
  }
}
