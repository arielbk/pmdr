import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertBundledApp,
  assertTarballCarriesApp,
  checkBundledApp,
  listTarballEntries,
  parseReleaseArgs,
  stageBundledApp,
} from "../release.js";

function makeRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "pmdr-release-app-"));
  mkdirSync(join(repoRoot, "apps/cli"), { recursive: true });
  return repoRoot;
}

function writeBundledApp(
  repoRoot: string,
  files: { zip?: string; metadata?: string },
): void {
  const dir = join(repoRoot, "apps/cli/bundled-app");
  mkdirSync(dir, { recursive: true });
  if (files.zip !== undefined) {
    writeFileSync(join(dir, "pmdr-app.zip"), files.zip);
  }
  if (files.metadata !== undefined) {
    writeFileSync(join(dir, "pmdr-app.json"), files.metadata);
  }
}

describe("checkBundledApp", () => {
  it("reports the zip as missing when the bundled-app directory is empty", () => {
    const repoRoot = makeRepo();

    const result = checkBundledApp(repoRoot);

    expect(result).toEqual({
      ok: false,
      problem: `no ${join(repoRoot, "apps/cli/bundled-app/pmdr-app.zip")}`,
    });
  });

  it("reports a zip with no readable version sidecar as not ok", () => {
    const repoRoot = makeRepo();
    writeBundledApp(repoRoot, { zip: "PK", metadata: "{ not json" });

    const result = checkBundledApp(repoRoot);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toMatch(
      /pmdr-app\.json.*no readable version/,
    );
  });

  it("reports the app version when the zip and sidecar are both in place", () => {
    const repoRoot = makeRepo();
    writeBundledApp(repoRoot, { zip: "PK", metadata: '{"version":"0.1.0"}' });

    expect(checkBundledApp(repoRoot)).toEqual({
      ok: true,
      version: "0.1.0",
      zipPath: join(repoRoot, "apps/cli/bundled-app/pmdr-app.zip"),
    });
  });
});

describe("assertBundledApp", () => {
  it("refuses to publish when the bundled app is missing, naming the fix", () => {
    const repoRoot = makeRepo();

    let message = "";
    try {
      assertBundledApp({ repoRoot, allowMissingApp: false });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Refusing to publish @arielbk/pmdr");
    expect(message).toContain("pmdr-app.zip");
    expect(message).toContain("pnpm menubar:zip");
    expect(message).toContain("gh run download");
    expect(message).toContain("--allow-missing-app");
  });

  it("lets an explicit --allow-missing-app release through", () => {
    const repoRoot = makeRepo();

    expect(assertBundledApp({ repoRoot, allowMissingApp: true }).ok).toBe(
      false,
    );
  });

  it("returns the located app when it is present", () => {
    const repoRoot = makeRepo();
    writeBundledApp(repoRoot, { zip: "PK", metadata: '{"version":"0.3.1"}' });

    const check = assertBundledApp({ repoRoot, allowMissingApp: false });

    expect(check.ok === true && check.version).toBe("0.3.1");
  });
});

describe("assertTarballCarriesApp", () => {
  it("fails when the packed tarball has no app zip in it", () => {
    expect(() =>
      assertTarballCarriesApp({
        tarballPath: "/repo/dist/releases/arielbk-pmdr-0.3.1.tgz",
        entries: ["package/package.json", "package/dist/index.js"],
      }),
    ).toThrow(/arielbk-pmdr-0\.3\.1\.tgz.*bundled-app\/pmdr-app\.zip/s);
  });
});

describe("listTarballEntries", () => {
  it("lists what a real tarball carries", () => {
    const root = mkdtempSync(join(tmpdir(), "pmdr-tarball-"));
    mkdirSync(join(root, "package/bundled-app"), { recursive: true });
    writeFileSync(join(root, "package/bundled-app/pmdr-app.zip"), "PK");
    const tarballPath = join(root, "arielbk-pmdr-0.3.1.tgz");
    execFileSync("tar", ["-czf", tarballPath, "-C", root, "package"]);

    const entries = listTarballEntries(tarballPath);

    expect(() =>
      assertTarballCarriesApp({ tarballPath, entries }),
    ).not.toThrow();
  });
});

describe("stageBundledApp", () => {
  it("copies a downloaded CI artifact into the package's bundled-app directory", () => {
    const repoRoot = makeRepo();
    const artifactDir = mkdtempSync(join(tmpdir(), "pmdr-artifact-"));
    writeFileSync(join(artifactDir, "pmdr-app.zip"), "PK-from-ci");
    writeFileSync(join(artifactDir, "pmdr-app.json"), '{"version":"0.4.0"}');

    stageBundledApp({ repoRoot, artifactDir });

    expect(checkBundledApp(repoRoot)).toEqual({
      ok: true,
      version: "0.4.0",
      zipPath: join(repoRoot, "apps/cli/bundled-app/pmdr-app.zip"),
    });
  });

  it("refuses an artifact directory that has no app zip in it", () => {
    const repoRoot = makeRepo();
    const artifactDir = mkdtempSync(join(tmpdir(), "pmdr-artifact-"));

    expect(() => stageBundledApp({ repoRoot, artifactDir })).toThrow(
      /pmdr-app\.zip/,
    );
  });
});

describe("parseReleaseArgs", () => {
  it("defaults to requiring the bundled app", () => {
    expect(parseReleaseArgs(["--dry-run", "--version", "0.3.1"])).toEqual({
      dryRun: true,
      nextVersion: "0.3.1",
      allowMissingApp: false,
      appArtifactDir: undefined,
    });
  });

  it("accepts an explicit opt-out and an artifact directory", () => {
    expect(
      parseReleaseArgs(["--version", "0.3.1", "--allow-missing-app"]),
    ).toMatchObject({ allowMissingApp: true });
    expect(
      parseReleaseArgs(["--version", "0.3.1", "--app-artifact", "/tmp/dl"]),
    ).toMatchObject({ appArtifactDir: "/tmp/dl" });
  });

  it("rejects --app-artifact with no directory", () => {
    expect(() =>
      parseReleaseArgs(["--version", "0.3.1", "--app-artifact"]),
    ).toThrow(/--app-artifact needs a directory/);
  });
});

describe("the packed tarball gate", () => {
  it("catches a real tarball built without the bundled-app directory", () => {
    const root = mkdtempSync(join(tmpdir(), "pmdr-tarball-"));
    mkdirSync(join(root, "package/dist"), { recursive: true });
    writeFileSync(join(root, "package/dist/index.js"), "#!/usr/bin/env node\n");
    const tarballPath = join(root, "arielbk-pmdr-0.3.1.tgz");
    execFileSync("tar", ["-czf", tarballPath, "-C", root, "package"]);

    expect(() =>
      assertTarballCarriesApp({
        tarballPath,
        entries: listTarballEntries(tarballPath),
      }),
    ).toThrow(/would ship without the menubar app/);
  });
});
