import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  assertValidVersion,
  createReleaseCommands,
  readCurrentVersion,
  readMenubarSourceVersion,
  stampReleaseVersion,
  stampVersion,
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

/** A project.yml shaped like the real one: two targets, only one versioned. */
const menubarProject = (marketingVersion: string) =>
  [
    "name: pmdr-menubar",
    "targets:",
    "  PmdrMenubarCore:",
    "    settings:",
    "      base:",
    "        PRODUCT_NAME: PmdrMenubarCore",
    "  pmdr-menubar:",
    "    settings:",
    "      base:",
    `        MARKETING_VERSION: "${marketingVersion}"`,
    '        CURRENT_PROJECT_VERSION: "1"',
    "",
  ].join("\n");

function withMenubarSources(
  repoRoot: string,
  marketingVersion: string,
): string {
  mkdirSync(join(repoRoot, "apps/menubar"), { recursive: true });
  const path = join(repoRoot, "apps/menubar/project.yml");
  writeFileSync(path, menubarProject(marketingVersion));
  return path;
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

describe("stampVersion", () => {
  it("writes the version into both the CLI and menubar manifests", () => {
    const repoRoot = makeRepoFixture({
      name: "@arielbk/pmdr",
      version: "0.3.0",
    });
    withMenubarSources(repoRoot, "0.1.2");

    stampVersion({ repoRoot, nextVersion: "0.3.1" });

    expect(readCurrentVersion(repoRoot)).toBe("0.3.1");
    expect(readMenubarSourceVersion(repoRoot)).toBe("0.3.1");
  });

  it("leaves the rest of the menubar manifest byte-identical", () => {
    const repoRoot = makeRepoFixture({
      name: "@arielbk/pmdr",
      version: "0.3.0",
    });
    const projectPath = withMenubarSources(repoRoot, "0.1.2");

    stampVersion({ repoRoot, nextVersion: "0.3.1" });

    expect(readFileSync(projectPath, "utf8")).toBe(menubarProject("0.3.1"));
  });

  it("is a no-op when the version is already stamped", () => {
    const repoRoot = makeRepoFixture({
      name: "@arielbk/pmdr",
      version: "0.3.0",
    });
    const projectPath = withMenubarSources(repoRoot, "0.1.2");
    const packageJsonPath = join(repoRoot, "apps/cli/package.json");

    stampVersion({ repoRoot, nextVersion: "0.3.1" });
    const afterFirst = {
      packageJson: readFileSync(packageJsonPath, "utf8"),
      project: readFileSync(projectPath, "utf8"),
    };

    stampVersion({ repoRoot, nextVersion: "0.3.1" });

    expect(readFileSync(packageJsonPath, "utf8")).toBe(afterFirst.packageJson);
    expect(readFileSync(projectPath, "utf8")).toBe(afterFirst.project);
  });

  it("refuses a menubar manifest with no MARKETING_VERSION", () => {
    const repoRoot = makeRepoFixture({
      name: "@arielbk/pmdr",
      version: "0.3.0",
    });
    mkdirSync(join(repoRoot, "apps/menubar"), { recursive: true });
    writeFileSync(
      join(repoRoot, "apps/menubar/project.yml"),
      "name: pmdr-menubar\n",
    );

    expect(() => stampVersion({ repoRoot, nextVersion: "0.3.1" })).toThrow(
      /MARKETING_VERSION/,
    );
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

describe("the release:version script", () => {
  it("is wired up so `pnpm release:version X.Y.Z` stamps both manifests", () => {
    const rootPackageJson = JSON.parse(
      readFileSync(join(__dirname, "../../../../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    // The version gate's error message tells the operator to run this exact
    // command, so the script has to exist under this exact name.
    expect(rootPackageJson.scripts?.["release:version"]).toBe(
      "node apps/cli/src/release.ts --stamp-only --version",
    );
  });
});

describe("the documented release procedure", () => {
  const skillPath = join(
    __dirname,
    "../../../../.claude/skills/release/SKILL.md",
  );

  it("leads with the stamp step, then the app zip, then the release", () => {
    const skill = readFileSync(skillPath, "utf8");

    const stamp = skill.indexOf("pnpm release:version");
    const zip = skill.indexOf("pnpm menubar:zip");
    const release = skill.indexOf("pnpm release:pmdr");

    expect(stamp).toBeGreaterThan(-1);
    expect(zip).toBeGreaterThan(stamp);
    expect(release).toBeGreaterThan(zip);
  });

  it("documents the same stamp-first sequence in the README", () => {
    const readme = readFileSync(join(__dirname, "../../../../README.md"), "utf8");

    const stamp = readme.indexOf("pnpm release:version");
    const zip = readme.indexOf("pnpm menubar:zip");
    const release = readme.indexOf("pnpm release:pmdr");

    expect(stamp).toBeGreaterThan(-1);
    expect(zip).toBeGreaterThan(stamp);
    expect(release).toBeGreaterThan(zip);
  });

  it("states the single-version rule the release gate enforces", () => {
    const skill = readFileSync(skillPath, "utf8");

    expect(skill).toMatch(/MARKETING_VERSION/);
    expect(skill).toMatch(/same version|one version|single version/i);
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
