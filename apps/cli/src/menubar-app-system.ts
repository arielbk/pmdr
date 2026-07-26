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
} from "./app-probes.js";

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
 * The real macOS side effects. Staging happens *inside* `~/Applications` rather
 * than `/tmp` so the swap is a same-volume `rename` — copying across volumes is
 * what breaks a bundle's symlinks, xattrs and therefore its code signature.
 */
export function createMenubarAppSystem(home: string = homedir()): MenubarAppSystem {
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
      try {
        execFileSync(
          "/usr/bin/osascript",
          ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`],
          { stdio: "ignore" },
        );
      } catch {
        // Not every build answers AppleScript; a signal is the honest fallback.
        try {
          execFileSync(
            "/usr/bin/pkill",
            ["-f", appProcessPattern(installedAppPath(home))],
            { stdio: "ignore" },
          );
        } catch {
          // pkill exits non-zero when nothing matched — already gone, fine.
        }
      }
    },

    launchApp(appPath) {
      execFileSync("/usr/bin/open", ["-a", appPath], { stdio: "ignore" });
    },

    writeLoginItem(plistPath, content) {
      mkdirSync(dirname(plistPath), { recursive: true });
      writeFileSync(plistPath, content, "utf8");
    },
  };
}
