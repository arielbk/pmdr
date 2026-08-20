import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The skill's folder name in an agent's skills directory. */
export const SKILL_NAME = "pmdr-cli";

/** Where `skills add` fetches it from — this repo, at `skills/pmdr-cli/`. */
export const SKILL_SOURCE = "arielbk/pmdr";

/**
 * The command to put in front of a human — in the README, and in setup's own
 * prompt. Deliberately the short interactive form: someone typing it themselves
 * should get the installer's own agent picker, not our opinion about scope.
 */
export const SKILL_ADD_HINT = `npx skills add ${SKILL_SOURCE}`;

/** The command that re-syncs an already-installed skill. */
export const SKILL_UPDATE_HINT = `npx skills update ${SKILL_NAME}`;

/**
 * The non-interactive form, for setup. `-g` because the skill documents the
 * globally installed `pmdr` rather than any one checkout; `-s` so that a repo
 * which later ships a second skill cannot widen what setup quietly installs.
 * Both `-y`s are load-bearing and different — the first is npx's "don't ask
 * before fetching", the second is the installer's "don't ask about scope".
 * Miss either and the child blocks on a prompt hidden behind our own.
 */
export function skillAddArgs(): string[] {
  return ["-y", "skills", "add", SKILL_SOURCE, "-g", "-s", SKILL_NAME, "-y"];
}

/**
 * Where the skill stands on this machine. `unavailable` is not a failure — it
 * is the common case of someone who does not use coding agents at all, and it
 * is the reason setup can stay quiet rather than explaining itself.
 */
export interface SkillInstallState {
  install: "installed" | "installable" | "unavailable";
  installedPath: string | null;
  /** Why nothing can be offered. Human-readable, and only set when unavailable. */
  reason: string | null;
}

/** The three filesystem facts the decision needs, and nothing else. */
export interface SkillProbeResult {
  /** An already-installed `pmdr-cli`, wherever it was found. */
  installedPath: string | null;
  /** An agent directory exists, so there is somewhere to install to. */
  agentDirPresent: boolean;
  /** `npx` is on PATH, so the installer can actually be run. */
  npxPresent: boolean;
}

export function deriveSkillState(probe: SkillProbeResult): SkillInstallState {
  if (probe.installedPath !== null) {
    return {
      install: "installed",
      installedPath: probe.installedPath,
      reason: null,
    };
  }
  if (!probe.agentDirPresent) {
    return {
      install: "unavailable",
      installedPath: null,
      reason: "no agent skills directory on this machine",
    };
  }
  if (!probe.npxPresent) {
    return {
      install: "unavailable",
      installedPath: null,
      reason: "npx is not on PATH",
    };
  }
  return { install: "installable", installedPath: null, reason: null };
}

/**
 * Agent directories worth looking in. `.claude` is Claude Code's; `.agents` is
 * where the `skills` installer keeps the real folders that every agent's
 * directory then symlinks into, so it is the one that answers "installed for
 * *some* agent" even when it was not Claude Code that asked.
 */
export function agentDirs(home: string): string[] {
  return [join(home, ".claude"), join(home, ".agents")];
}

export function skillDirs(home: string): string[] {
  return agentDirs(home).map((dir) => join(dir, "skills", SKILL_NAME));
}

/**
 * Look for `command` in PATH without spawning anything. Setup runs on someone's
 * first pomodoro; paying for a subprocess just to find out whether we may offer
 * an optional extra is the wrong trade.
 */
function onPath(
  command: string,
  pathValue: string,
  exists: (path: string) => boolean,
): boolean {
  return pathValue
    .split(":")
    .filter((dir) => dir.length > 0)
    .some((dir) => exists(join(dir, command)));
}

export interface AgentSkill {
  state(): SkillInstallState;
  /**
   * Runs the installer with its output going straight to the terminal. Nothing
   * is captured: this reaches the network and takes a few seconds, and a silent
   * stall is worse than borrowing the installer's own progress reporting.
   */
  install(): { ok: boolean };
}

export interface AgentSkillDeps {
  home?: string;
  path?: string;
  exists?: (path: string) => boolean;
  /** Run `npx` with `args`, inheriting stdio. Returns its exit code. */
  runNpx?: (args: string[]) => number;
}

function runNpxInherited(args: string[]): number {
  const result = spawnSync("npx", args, { stdio: "inherit" });
  if (result.error) return 1;
  return result.status ?? 1;
}

export function createAgentSkill(deps: AgentSkillDeps = {}): AgentSkill {
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? existsSync;
  const pathValue = deps.path ?? process.env.PATH ?? "";
  const runNpx = deps.runNpx ?? runNpxInherited;

  return {
    state() {
      return deriveSkillState({
        installedPath: skillDirs(home).find((dir) => exists(dir)) ?? null,
        agentDirPresent: agentDirs(home).some((dir) => exists(dir)),
        npxPresent: onPath("npx", pathValue, exists),
      });
    },

    install() {
      return { ok: runNpx(skillAddArgs()) === 0 };
    },
  };
}
