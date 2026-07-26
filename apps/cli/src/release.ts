import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@arielbk/pmdr";

const sourcePath = fileURLToPath(import.meta.url);
const appRoot = resolve(dirname(sourcePath), "..");
const defaultRepoRoot = resolve(appRoot, "../..");

export type ReleaseCommand = {
  command: string;
  args: string[];
  cwd: string;
};

/**
 * Where the release expects to find the CI-built menubar app. Kept as literals
 * rather than imported from `bundled-app.ts` so this module stays runnable with
 * plain `node` (it is invoked as a script, before any build step).
 */
export function bundledAppPaths(repoRoot: string): {
  dir: string;
  zip: string;
  metadata: string;
} {
  const dir = resolve(repoRoot, "apps/cli/bundled-app");
  return {
    dir,
    zip: resolve(dir, "pmdr-app.zip"),
    metadata: resolve(dir, "pmdr-app.json"),
  };
}

export type BundledAppCheck =
  | { ok: true; version: string; zipPath: string }
  | { ok: false; problem: string };

export function checkBundledApp(repoRoot: string): BundledAppCheck {
  const paths = bundledAppPaths(repoRoot);

  if (!existsSync(paths.zip)) {
    return { ok: false, problem: `no ${paths.zip}` };
  }

  const version = readBundledAppVersion(paths.metadata);
  if (version === null) {
    return {
      ok: false,
      problem: `${paths.metadata} has no readable version`,
    };
  }

  return { ok: true, version, zipPath: paths.zip };
}

/** Artifact name the CI workflow uploads the bundled app under. */
export const APP_ARTIFACT_NAME = "pmdr-app";

/**
 * The publish gate: a release that should carry the menubar app must actually
 * carry it. `--allow-missing-app` is the deliberate escape hatch for a
 * CLI-only release; without it, a missing zip fails loudly before anything is
 * stamped, built or published.
 */
export function assertBundledApp(options: {
  repoRoot: string;
  allowMissingApp: boolean;
}): BundledAppCheck {
  const check = checkBundledApp(options.repoRoot);

  if (check.ok || options.allowMissingApp) {
    return check;
  }

  throw new Error(
    [
      `Refusing to publish ${packageName} without the bundled menubar app.`,
      `  ${check.problem}`,
      "  Build it locally:  pnpm menubar:zip",
      `  Or take the CI-built one:  gh run download --name ${APP_ARTIFACT_NAME} --dir apps/cli/bundled-app`,
      "  Or pass --allow-missing-app to publish a CLI-only release on purpose.",
    ].join("\n"),
  );
}

/**
 * Consume a downloaded CI artifact: copy the zip and its version sidecar into
 * the directory `files` publishes from. Both must be present — half an artifact
 * would stage a zip whose version the CLI cannot read.
 */
export function stageBundledApp(options: {
  repoRoot: string;
  artifactDir: string;
}): string {
  const paths = bundledAppPaths(options.repoRoot);
  const sources = {
    zip: resolve(options.artifactDir, "pmdr-app.zip"),
    metadata: resolve(options.artifactDir, "pmdr-app.json"),
  };

  for (const source of [sources.zip, sources.metadata]) {
    if (!existsSync(source)) {
      throw new Error(`--app-artifact directory has no ${source}`);
    }
  }

  mkdirSync(paths.dir, { recursive: true });
  copyFileSync(sources.zip, paths.zip);
  copyFileSync(sources.metadata, paths.metadata);

  return paths.dir;
}

/**
 * The gate's second half: the zip existing on disk is not the same as `files`
 * having shipped it. Read the packed tarball's own listing and check.
 */
export function assertTarballCarriesApp(options: {
  tarballPath: string;
  entries: string[];
}): void {
  const carries = options.entries.some((entry) =>
    entry.endsWith("/bundled-app/pmdr-app.zip"),
  );

  if (!carries) {
    throw new Error(
      `Packed ${options.tarballPath} does not contain bundled-app/pmdr-app.zip — the release would ship without the menubar app.`,
    );
  }
}

export function listTarballEntries(tarballPath: string): string[] {
  return execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

function readBundledAppVersion(metadataPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : null;
  } catch {
    return null;
  }
}

export function bumpVersion(
  version: string,
  release: "major" | "minor" | "patch",
): string {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(version);
  if (!match) {
    throw new Error(`Cannot bump non-stable semver version: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (release === "major") {
    return `${major + 1}.0.0`;
  }
  if (release === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function assertValidVersion(version: string): void {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected an exact semver version, received: ${version}`);
  }
}

export function stampReleaseVersion(options: {
  repoRoot: string;
  nextVersion: string;
}): string {
  assertValidVersion(options.nextVersion);

  const packageJsonPath = resolve(options.repoRoot, "apps/cli/package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
  };

  if (packageJson.name !== packageName) {
    throw new Error(`Expected ${packageJsonPath} to declare ${packageName}`);
  }

  packageJson.version = options.nextVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  return packageJsonPath;
}

export function createReleaseCommands(options: {
  repoRoot: string;
  dryRun: boolean;
  tarballDirectory: string;
}): ReleaseCommand[] {
  const cliRoot = resolve(options.repoRoot, "apps/cli");
  return [
    {
      command: "pnpm",
      args: ["--filter", packageName, "build"],
      cwd: options.repoRoot,
    },
    {
      command: "npm",
      args: ["pack", "--pack-destination", options.tarballDirectory],
      cwd: cliRoot,
    },
    options.dryRun
      ? {
          command: "npm",
          args: ["publish", "--dry-run", "--access", "public"],
          cwd: cliRoot,
        }
      : {
          command: "npm",
          args: ["publish", "--access", "public"],
          cwd: cliRoot,
        },
  ];
}

export function packedTarballPath(options: {
  tarballDirectory: string;
  version: string;
}): string {
  return resolve(
    options.tarballDirectory,
    `arielbk-pmdr-${options.version}.tgz`,
  );
}

export function runRelease(options: {
  repoRoot: string;
  nextVersion: string;
  dryRun: boolean;
  allowMissingApp?: boolean;
  appArtifactDir?: string;
}): void {
  const tarballDirectory = resolve(options.repoRoot, "dist/releases");
  const allowMissingApp = options.allowMissingApp === true;

  if (options.appArtifactDir !== undefined) {
    const staged = stageBundledApp({
      repoRoot: options.repoRoot,
      artifactDir: resolve(options.appArtifactDir),
    });
    process.stdout.write(`release: staged CI menubar app into ${staged}\n`);
  }

  // Gate before stamping: a refused release must not leave a bumped version behind.
  const app = assertBundledApp({ repoRoot: options.repoRoot, allowMissingApp });
  process.stdout.write(
    app.ok
      ? `release: bundling menubar app ${app.version}\n`
      : `release: publishing without the menubar app (--allow-missing-app): ${app.problem}\n`,
  );

  stampReleaseVersion({
    repoRoot: options.repoRoot,
    nextVersion: options.nextVersion,
  });

  mkdirSync(tarballDirectory, { recursive: true });

  for (const releaseCommand of createReleaseCommands({
    repoRoot: options.repoRoot,
    dryRun: options.dryRun,
    tarballDirectory,
  })) {
    execFileSync(releaseCommand.command, releaseCommand.args, {
      cwd: releaseCommand.cwd,
      env: {
        ...process.env,
        npm_config_cache: resolve(tmpdir(), "pmdr-release-npm-cache"),
      },
      stdio: "inherit",
    });

    // The zip being on disk is not the same as `files` having shipped it, so
    // check the packed tarball itself before the publish step runs.
    if (releaseCommand.args[0] === "pack" && !allowMissingApp) {
      const tarballPath = packedTarballPath({
        tarballDirectory,
        version: options.nextVersion,
      });
      assertTarballCarriesApp({
        tarballPath,
        entries: listTarballEntries(tarballPath),
      });
    }
  }
}

export function readCurrentVersion(repoRoot: string): string {
  const packageJson = JSON.parse(
    readFileSync(resolve(repoRoot, "apps/cli/package.json"), "utf8"),
  ) as { version?: string };
  if (typeof packageJson.version !== "string") {
    throw new Error("apps/cli/package.json is missing version");
  }
  return packageJson.version;
}

export type ReleaseArgs = {
  dryRun: boolean;
  nextVersion: string;
  allowMissingApp: boolean;
  appArtifactDir: string | undefined;
};

export function parseReleaseArgs(args: string[]): ReleaseArgs {
  let dryRun = false;
  let allowMissingApp = false;
  let appArtifactDir: string | undefined;
  let explicitVersion: string | undefined;
  let release: "major" | "minor" | "patch" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--allow-missing-app") {
      allowMissingApp = true;
    } else if (arg === "--app-artifact") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--app-artifact needs a directory");
      }
      appArtifactDir = value;
      index += 1;
    } else if (arg === "--version") {
      explicitVersion = args[index + 1];
      index += 1;
    } else if (arg === "--bump") {
      const value = args[index + 1];
      if (value !== "major" && value !== "minor" && value !== "patch") {
        throw new Error("--bump must be one of: major, minor, patch");
      }
      release = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: pnpm release:pmdr -- --dry-run (--version x.y.z | --bump patch|minor|major)",
          "  --app-artifact <dir>   stage a downloaded CI pmdr-app artifact before packing",
          "  --allow-missing-app    publish a CLI-only release without the menubar app",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }

  if (explicitVersion && release) {
    throw new Error("Use either --version or --bump, not both");
  }

  if (explicitVersion) {
    return {
      dryRun,
      nextVersion: explicitVersion,
      allowMissingApp,
      appArtifactDir,
    };
  }

  if (release) {
    return {
      dryRun,
      nextVersion: bumpVersion(readCurrentVersion(defaultRepoRoot), release),
      allowMissingApp,
      appArtifactDir,
    };
  }

  throw new Error("Pass --version x.y.z or --bump patch|minor|major");
}

if (process.argv[1] && existsSync(process.argv[1])) {
  const invokedPath = resolve(process.argv[1]);
  if (invokedPath === sourcePath) {
    try {
      const options = parseReleaseArgs(process.argv.slice(2));
      runRelease({
        repoRoot: defaultRepoRoot,
        nextVersion: options.nextVersion,
        dryRun: options.dryRun,
        allowMissingApp: options.allowMissingApp,
        appArtifactDir: options.appArtifactDir,
      });
    } catch (error) {
      // Loud, but a message rather than a stack trace: every throw in here is
      // an operator-facing refusal, not a bug.
      process.stderr.write(`release: ${(error as Error).message}\n`);
      process.exit(1);
    }
  }
}
