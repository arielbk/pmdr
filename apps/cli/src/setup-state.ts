import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { defaultConfigDir } from "./config.js";

/** Where completed setup is recorded, alongside `config.json` in the config dir. */
export const SETUP_MARKER_FILE = "setup.json";

export interface SetupMarker {
  completedAt: string;
  version: string;
}

/**
 * The record that `pmdr setup` finished. Its only job is to keep bare `pmdr`
 * from routing back into onboarding, so a corrupt or half-written marker counts
 * as "set up" rather than trapping someone in a setup loop they cannot leave.
 */
export function createSetupMarkerStore(configDir: string = defaultConfigDir()) {
  const file = join(configDir, SETUP_MARKER_FILE);

  return {
    exists(): boolean {
      return existsSync(file);
    },

    read(): SetupMarker | null {
      try {
        const parsed = JSON.parse(
          readFileSync(file, "utf8"),
        ) as Partial<SetupMarker>;
        if (typeof parsed.completedAt !== "string") return null;
        return {
          completedAt: parsed.completedAt,
          version:
            typeof parsed.version === "string" ? parsed.version : "unknown",
        };
      } catch {
        return null;
      }
    },

    record(marker: SetupMarker): void {
      mkdirSync(configDir, { recursive: true });
      const tmpFile = `${file}.${process.pid}.tmp`;
      writeFileSync(tmpFile, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
      renameSync(tmpFile, file);
    },
  };
}

export interface SetupEvidence {
  /** `setup.json` is present — someone has been through onboarding. */
  hasMarker: boolean;
  /** `config.json` is present — durations or sounds have been changed. */
  hasConfig: boolean;
  /** At least one project exists. */
  hasProjects: boolean;
  /** A session has been started before (live state or logged completions). */
  hasSessionHistory: boolean;
}

/**
 * Whether this install counts as set up.
 *
 * The marker is the real signal, but it only starts existing once `pmdr setup`
 * ships — so prior use counts too. Without that, every existing install would
 * be dropped into onboarding by an upgrade, which is the one thing routing bare
 * `pmdr` through setup must never do.
 */
export function isSetUp(evidence: SetupEvidence): boolean {
  return (
    evidence.hasMarker ||
    evidence.hasConfig ||
    evidence.hasProjects ||
    evidence.hasSessionHistory
  );
}
