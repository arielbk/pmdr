import { describe, expect, it } from "vitest";
import {
  SKILL_ADD_HINT,
  SKILL_NAME,
  SKILL_SOURCE,
  SKILL_UPDATE_HINT,
  createAgentSkill,
  deriveSkillState,
  skillAddArgs,
} from "../agent-skill.js";

const HOME = "/Users/x";
const PATH_WITH_NPX = "/usr/bin:/opt/homebrew/bin";

/** A fake filesystem: every listed path exists, nothing else does. */
function fs(...present: string[]) {
  const set = new Set(present);
  return (path: string) => set.has(path);
}

describe("deriveSkillState", () => {
  it("reports an installed skill wherever it was found", () => {
    expect(
      deriveSkillState({
        installedPath: "/Users/x/.claude/skills/pmdr-cli",
        agentDirPresent: true,
        npxPresent: true,
      }),
    ).toEqual({
      install: "installed",
      installedPath: "/Users/x/.claude/skills/pmdr-cli",
      reason: null,
    });
  });

  it("is installable when there is an agent directory and an npx to run", () => {
    expect(
      deriveSkillState({
        installedPath: null,
        agentDirPresent: true,
        npxPresent: true,
      }),
    ).toMatchObject({ install: "installable", reason: null });
  });

  it("is unavailable, with a reason, when no agent directory exists", () => {
    const state = deriveSkillState({
      installedPath: null,
      agentDirPresent: false,
      npxPresent: true,
    });

    expect(state.install).toBe("unavailable");
    expect(state.reason).toContain("agent skills directory");
  });

  it("is unavailable when the installer could not be run", () => {
    // Offering an install we cannot perform is the one outcome worth avoiding:
    // it turns a helpful question into a dead end.
    const state = deriveSkillState({
      installedPath: null,
      agentDirPresent: true,
      npxPresent: false,
    });

    expect(state.install).toBe("unavailable");
    expect(state.reason).toContain("npx");
  });

  it("counts an installed skill even where npx has since gone missing", () => {
    expect(
      deriveSkillState({
        installedPath: "/Users/x/.agents/skills/pmdr-cli",
        agentDirPresent: true,
        npxPresent: false,
      }),
    ).toMatchObject({ install: "installed" });
  });
});

describe("createAgentSkill state", () => {
  it("finds a skill installed under .claude", () => {
    const skill = createAgentSkill({
      home: HOME,
      path: PATH_WITH_NPX,
      exists: fs(
        "/Users/x/.claude",
        `/Users/x/.claude/skills/${SKILL_NAME}`,
        "/usr/bin/npx",
      ),
    });

    expect(skill.state()).toMatchObject({
      install: "installed",
      installedPath: `/Users/x/.claude/skills/${SKILL_NAME}`,
    });
  });

  it("finds a skill installed under .agents by another agent's install", () => {
    // The `skills` installer keeps the real folder in ~/.agents and symlinks
    // each agent's directory at it, so this is what "already installed" looks
    // like for someone who added it from a different agent.
    const skill = createAgentSkill({
      home: HOME,
      path: PATH_WITH_NPX,
      exists: fs(
        "/Users/x/.agents",
        `/Users/x/.agents/skills/${SKILL_NAME}`,
        "/usr/bin/npx",
      ),
    });

    expect(skill.state()).toMatchObject({ install: "installed" });
  });

  it("is installable with an agent directory but no skill yet", () => {
    const skill = createAgentSkill({
      home: HOME,
      path: PATH_WITH_NPX,
      exists: fs("/Users/x/.claude", "/opt/homebrew/bin/npx"),
    });

    expect(skill.state()).toMatchObject({ install: "installable" });
  });

  it("is unavailable on a machine with no agent directory at all", () => {
    const skill = createAgentSkill({
      home: HOME,
      path: PATH_WITH_NPX,
      exists: fs("/usr/bin/npx"),
    });

    expect(skill.state()).toMatchObject({ install: "unavailable" });
  });

  it("does not spawn anything to decide whether npx is there", () => {
    // A PATH entry that exists only as a directory name must not count, and no
    // subprocess may be run: setup is on the path to a first pomodoro.
    const skill = createAgentSkill({
      home: HOME,
      path: "/empty/bin",
      exists: fs("/Users/x/.claude", "/empty/bin"),
      runNpx: () => {
        throw new Error("state() must not run anything");
      },
    });

    expect(skill.state()).toMatchObject({
      install: "unavailable",
      reason: "npx is not on PATH",
    });
  });
});

describe("createAgentSkill install", () => {
  it("reports success on a zero exit", () => {
    const skill = createAgentSkill({ runNpx: () => 0 });

    expect(skill.install()).toEqual({ ok: true });
  });

  it("reports failure on a non-zero exit rather than throwing", () => {
    const skill = createAgentSkill({ runNpx: () => 1 });

    expect(skill.install()).toEqual({ ok: false });
  });

  it("runs the installer non-interactively, scoped to this one skill", () => {
    const calls: string[][] = [];
    createAgentSkill({
      runNpx: (args) => {
        calls.push(args);
        return 0;
      },
    }).install();

    expect(calls).toHaveLength(1);
    const args = calls[0]!;
    expect(args).toEqual(skillAddArgs());
    expect(args).toContain(SKILL_SOURCE);
    // Scoped by name, so a second skill added to this repo later cannot widen
    // what setup silently installs.
    expect(args.slice(args.indexOf("-s"))).toContain(SKILL_NAME);
    // Both prompts suppressed: npx's fetch confirmation and the installer's
    // scope question. Either one left in place hangs setup behind our prompt.
    expect(args.filter((a) => a === "-y")).toHaveLength(2);
    expect(args).toContain("-g");
  });
});

describe("the commands shown to humans", () => {
  it("point at this repo", () => {
    expect(SKILL_ADD_HINT).toBe(`npx skills add ${SKILL_SOURCE}`);
    expect(SKILL_UPDATE_HINT).toBe(`npx skills update ${SKILL_NAME}`);
  });

  it("keep the add hint interactive, so a human picks their own agents", () => {
    expect(SKILL_ADD_HINT).not.toContain("-y");
    expect(SKILL_ADD_HINT).not.toContain("-g");
  });
});
