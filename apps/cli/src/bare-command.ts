import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decideBareRoute } from "./bare-route.js";
import { defaultConfigDir } from "./config.js";
import { createProjectsModule } from "./projects.js";
import { createSetupMarkerStore } from "./setup-state.js";
import { isSetUp, type SetupEvidence } from "./setup-state.js";
import { createStateModule, deriveState } from "./state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

/**
 * Reads the four traces of a configured install off disk. Every check is
 * failure-tolerant on purpose: an unreadable state dir should not decide that
 * someone has never used pmdr and drop them into onboarding.
 */
export function gatherSetupEvidence(
  stateDir: string = STATE_DIR,
  configDir: string = defaultConfigDir(),
): SetupEvidence {
  const marker = createSetupMarkerStore(configDir);

  let hasProjects = false;
  try {
    hasProjects = createProjectsModule(stateDir).readProjects().length > 0;
  } catch {
    hasProjects = existsSync(join(stateDir, "projects.json"));
  }

  return {
    hasMarker: marker.exists(),
    hasConfig: existsSync(join(configDir, "config.json")),
    hasProjects,
    hasSessionHistory:
      existsSync(join(stateDir, "state.json")) ||
      existsSync(join(stateDir, "completions.jsonl")),
  };
}

/**
 * Bare `pmdr`. Resolves the route, then runs it. The command modules are
 * imported lazily so that the two routes nobody took cost nothing — in
 * particular, a plain `pmdr start` never loads the prompt library.
 */
export async function runBareCommand(): Promise<void> {
  const store = createStateModule(STATE_DIR);
  const now = Date.now();
  try {
    // An expired focus has to become its pending break before the session is
    // read, or `pmdr` would try to start on top of a phase change it triggered.
    store.advancePhaseIfExpired(now);
  } catch {
    // Nothing to advance, or the state dir is unwritable — either way the
    // derived state below is still the truth we route on.
  }

  const file = store.readState();
  const route = decideBareRoute({
    setUp: isSetUp(gatherSetupEvidence()),
    isTty: process.stdin.isTTY === true && process.stdout.isTTY === true,
    session: deriveState({ file, now }).kind,
  });

  if (route === "setup") {
    const { runSetup, realSetupDeps, CANCELLED_MESSAGE } =
      await import("./commands/setup.js");
    const result = await runSetup(await realSetupDeps());
    if (result.status === "cancelled") {
      console.log(CANCELLED_MESSAGE);
      process.exitCode = 1;
    }
    return;
  }

  // Installs that predate `pmdr setup` never went through its app step, so the
  // one-time offer stays on the timer routes as their path to the menubar app.
  // It gates itself on an interactive TTY, so no agent or script is ever blocked
  // by it, and setup records a decline through the same store — say no once,
  // wherever you were asked, and you are not asked again.
  const { maybeOfferBundledApp } = await import("./first-run-prompt.js");
  await maybeOfferBundledApp([]);

  if (route === "attach" && file) {
    const { attachBanner, decideCountdown, runCountdown } =
      await import("./commands/start.js");
    console.log(attachBanner(file));
    const countdown = decideCountdown({
      detach: false,
      stdoutIsTty: process.stdout.isTTY === true,
    });
    if (!countdown.render) {
      if (countdown.note) console.log(countdown.note);
      return;
    }
    await runCountdown(store);
    return;
  }

  const { runStart } = await import("./commands/start.js");
  await runStart({});
}
