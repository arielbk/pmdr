import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  APP_BUNDLE_ID,
  APP_BUNDLE_NAME,
  appProcessPattern,
  installedAppPath,
  isAppProcessRunning,
} from "./app-probes.js";

/**
 * Blocking sleep. The whole install path is synchronous — turning it async to
 * wait on macOS would ripple through every caller — and these waits are short
 * and only ever happen while nothing else needs the thread.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Poll `done` until it is true or the budget runs out. Returns whether it ever
 * came true, so callers can decide how much a timeout matters to them.
 */
function waitUntil(
  done: () => boolean,
  options: { timeoutMs: number; stepMs: number; sleep: (ms: number) => void },
): boolean {
  for (let waited = 0; waited < options.timeoutMs; waited += options.stepMs) {
    if (done()) return true;
    options.sleep(options.stepMs);
  }
  return done();
}

/** `execFileSync` puts the useful part on stderr, not in `error.message`. */
function commandFailure(error: unknown): string {
  const stderr = (error as { stderr?: Buffer | string } | null)?.stderr;
  const detail = (stderr === undefined ? "" : String(stderr)).trim();
  const message = error instanceof Error ? error.message : String(error);
  return detail.length > 0 ? `${message}: ${detail}` : message;
}

export interface ReplaceBundleInput {
  zipPath: string;
  appPath: string;
  /**
   * Called once a valid replacement is staged and immediately before the swap.
   * The hook exists so callers can quit the running app at the only safe moment
   * — a failed extract must never leave someone with a killed app and nothing
   * to launch.
   */
  beforeSwap(): void;
}

/**
 * Every side effect the menubar app module needs, stated as guarantees rather
 * than filesystem primitives. Each verb either happens completely or throws;
 * none of them leaks how it is achieved.
 */
export interface MenubarAppSystem {
  /** Puts the bundle from `zipPath` at `appPath`, atomically as far as callers see. */
  replaceBundle(input: ReplaceBundleInput): void;
  /** Removes a path if it is there. Returns whether anything was removed. */
  removePath(path: string): boolean;
  quitApp(): void;
  launchApp(appPath: string): void;
  /** Writes the LaunchAgent plist, creating `LaunchAgents` if it is missing. */
  writeLoginItem(plistPath: string, content: string): void;
}

/**
 * The two racy parts of an install — waiting out a quit, retrying a launch —
 * are only observable through the clock and `pgrep`, so both are injectable.
 * Nothing else in here is: it exists precisely to be the real side effects.
 */
export interface MenubarAppSystemDeps {
  /** Launch the bundle at `appPath`. Throws the way `execFileSync` does. */
  open?: (appPath: string) => void;
  /** Ask the running app to quit. Asking only — the waiting is not its job. */
  requestQuit?: (appPath: string) => void;
  isRunning?: (appPath: string) => boolean;
  sleep?: (ms: number) => void;
}

/**
 * Ask the app to quit, by name and then by signal. AppleScript is preferred so
 * the app gets to shut down cleanly; not every build answers it, and a signal
 * is the honest fallback. Either way this returns before the app is gone.
 */
function requestQuitViaSystem(appPath: string): void {
  try {
    execFileSync(
      "/usr/bin/osascript",
      ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`],
      { stdio: "ignore" },
    );
  } catch {
    try {
      execFileSync("/usr/bin/pkill", ["-f", appProcessPattern(appPath)], {
        stdio: "ignore",
      });
    } catch {
      // pkill exits non-zero when nothing matched — already gone, fine.
    }
  }
}

/**
 * The real macOS side effects. Staging happens *inside* `~/Applications` rather
 * than `/tmp` so the swap is a same-volume `rename` — copying across volumes is
 * what breaks a bundle's symlinks, xattrs and therefore its code signature.
 */
export function createMenubarAppSystem(
  home: string = homedir(),
  deps: MenubarAppSystemDeps = {},
): MenubarAppSystem {
  const open =
    deps.open ??
    ((appPath: string) => {
      execFileSync("/usr/bin/open", ["-a", appPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    });
  const requestQuit = deps.requestQuit ?? requestQuitViaSystem;
  const isRunning = deps.isRunning ?? isAppProcessRunning;
  const sleep = deps.sleep ?? sleepSync;

  return {
    replaceBundle({ zipPath, appPath, beforeSwap }) {
      const applications = dirname(appPath);
      mkdirSync(applications, { recursive: true });
      const staging = mkdtempSync(join(applications, ".pmdr-install-"));

      try {
        execFileSync("/usr/bin/ditto", ["-x", "-k", zipPath, staging], {
          stdio: ["ignore", "ignore", "pipe"],
        });

        const staged = join(staging, APP_BUNDLE_NAME);
        if (!existsSync(staged)) {
          throw new Error(`extracted archive contained no ${APP_BUNDLE_NAME}`);
        }

        beforeSwap();
        rmSync(appPath, { recursive: true, force: true });
        renameSync(staged, appPath);
      } finally {
        // Staging cleanup must never mask the real outcome of the install.
        try {
          rmSync(staging, { recursive: true, force: true });
        } catch {
          // best effort — a leftover temp dir is not worth failing over
        }
      }
    },

    removePath(path) {
      if (!existsSync(path)) return false;
      rmSync(path, { recursive: true, force: true });
      return true;
    },

    quitApp() {
      const appPath = installedAppPath(home);
      requestQuit(appPath);

      // Both quits are asynchronous: they ask, they do not wait. An install
      // that swapped the bundle out from under a live instance would then hand
      // LaunchServices a process it is still tearing down, and the relaunch
      // fails with -600. Give it time to actually go; if it will not, carry on
      // and let the swap and launch report their own failure honestly.
      waitUntil(() => !isRunning(appPath), {
        timeoutMs: 5_000,
        stepMs: 100,
        sleep,
      });
    },

    launchApp(appPath) {
      // LaunchServices can still be holding the old registration for this path
      // for a moment after the swap, answering -600 (procNotFound) for a bundle
      // that is right there. It clears on its own, so retry briefly rather than
      // telling someone their freshly installed app could not be launched.
      let lastError: unknown;
      const launched = waitUntil(
        () => {
          try {
            open(appPath);
            return true;
          } catch (error) {
            lastError = error;
            return false;
          }
        },
        { timeoutMs: 5_000, stepMs: 250, sleep },
      );

      if (!launched) throw new Error(commandFailure(lastError));
    },

    writeLoginItem(plistPath, content) {
      mkdirSync(dirname(plistPath), { recursive: true });
      writeFileSync(plistPath, content, "utf8");
    },
  };
}
