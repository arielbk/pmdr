import { describe, expect, it } from "vitest";
import { nonMacosMessage, runOnMacos } from "../commands/app.js";

function harness(platform: string, action = "install") {
  const err: string[] = [];
  let ran = false;

  const code = runOnMacos({
    platform,
    action,
    stderr: (line) => err.push(line),
    run: () => {
      ran = true;
      return 0;
    },
  });

  return { code, err, ran };
}

describe("the macOS gate every `pmdr app` subcommand goes through", () => {
  it("runs the subcommand and passes its exit code through on macOS", () => {
    const { code, err, ran } = harness("darwin");

    expect(ran).toBe(true);
    expect(code).toBe(0);
    expect(err).toEqual([]);
  });

  it("refuses with one clear line elsewhere, without running anything", () => {
    const { code, err, ran } = harness("linux");

    expect(ran).toBe(false);
    expect(code).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("macOS");
  });

  it("names the action it is refusing, so all four subcommands read right", () => {
    expect(nonMacosMessage("install")).toContain("nothing to install");
    expect(nonMacosMessage("report")).toContain("nothing to report");
    expect(nonMacosMessage("configure")).toContain("nothing to configure");
    expect(nonMacosMessage("uninstall")).toContain("nothing to uninstall");
  });
});
