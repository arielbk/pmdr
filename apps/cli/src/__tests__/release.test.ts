import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  assertValidVersion,
  createReleaseCommands,
  readCurrentVersion,
  stampReleaseVersion,
} from "../release.js";

function makeRepoFixture(packageJson: Record<string, unknown>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "pmdr-release-"));
  mkdirSync(join(repoRoot, "apps/cli"), { recursive: true });
  writeFileSync(
    join(repoRoot, "apps/cli/package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  return repoRoot;
}

describe("bumpVersion", () => {
  it("bumps each release segment", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("rejects prerelease versions", () => {
    expect(() => bumpVersion("1.2.3-beta.1", "patch")).toThrow(
      /non-stable semver/,
    );
  });
});

describe("assertValidVersion", () => {
  it("accepts exact semver, rejects ranges and garbage", () => {
    expect(() => assertValidVersion("0.2.0")).not.toThrow();
    expect(() => assertValidVersion("0.2.0-rc.1")).not.toThrow();
    expect(() => assertValidVersion("^0.2.0")).toThrow(/exact semver/);
    expect(() => assertValidVersion("latest")).toThrow(/exact semver/);
  });
});

describe("stampReleaseVersion", () => {
  it("writes the next version into apps/cli/package.json", () => {
    const repoRoot = makeRepoFixture({
      name: "@arielbk/pmdr",
      version: "0.1.0",
    });

    stampReleaseVersion({ repoRoot, nextVersion: "0.2.0" });

    expect(readCurrentVersion(repoRoot)).toBe("0.2.0");
  });

  it("refuses to stamp a package that is not @arielbk/pmdr", () => {
    const repoRoot = makeRepoFixture({ name: "cli", version: "0.1.0" });

    expect(() =>
      stampReleaseVersion({ repoRoot, nextVersion: "0.2.0" }),
    ).toThrow(/@arielbk\/pmdr/);
  });
});

describe("createReleaseCommands", () => {
  it("builds, packs, then publishes from apps/cli", () => {
    const commands = createReleaseCommands({
      repoRoot: "/repo",
      dryRun: false,
      tarballDirectory: "/repo/dist/releases",
    });

    expect(commands.map((command) => command.command)).toEqual([
      "pnpm",
      "npm",
      "npm",
    ]);
    expect(commands[0]?.args).toEqual(["--filter", "@arielbk/pmdr", "build"]);
    expect(commands[2]?.args).toEqual(["publish", "--access", "public"]);
    expect(commands[2]?.cwd).toBe(join("/repo", "apps/cli"));
  });

  it("gates publish behind --dry-run", () => {
    const commands = createReleaseCommands({
      repoRoot: "/repo",
      dryRun: true,
      tarballDirectory: "/repo/dist/releases",
    });

    expect(commands[2]?.args).toContain("--dry-run");
  });
});

describe("publishable CLI package", () => {
  it("declares @arielbk/pmdr as a public package with the built bin", () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf8"),
    ) as {
      name?: string;
      version?: string;
      private?: boolean;
      bin?: Record<string, string>;
      publishConfig?: { access?: string };
      files?: string[];
    };

    expect(packageJson.name).toBe("@arielbk/pmdr");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.bin?.pmdr).toBe("dist/index.js");
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.files).toEqual(["dist", "bundled-app"]);
  });
});
