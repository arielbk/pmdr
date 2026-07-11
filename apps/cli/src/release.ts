import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function runRelease(options: {
  repoRoot: string;
  nextVersion: string;
  dryRun: boolean;
}): void {
  const tarballDirectory = resolve(options.repoRoot, "dist/releases");

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

function parseArgs(args: string[]): {
  dryRun: boolean;
  nextVersion: string;
} {
  let dryRun = false;
  let explicitVersion: string | undefined;
  let release: "major" | "minor" | "patch" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      dryRun = true;
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
        "Usage: pnpm release:pmdr -- --dry-run (--version x.y.z | --bump patch|minor|major)\n",
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
    return { dryRun, nextVersion: explicitVersion };
  }

  if (release) {
    return {
      dryRun,
      nextVersion: bumpVersion(readCurrentVersion(defaultRepoRoot), release),
    };
  }

  throw new Error("Pass --version x.y.z or --bump patch|minor|major");
}

if (process.argv[1] && existsSync(process.argv[1])) {
  const invokedPath = resolve(process.argv[1]);
  if (invokedPath === sourcePath) {
    const options = parseArgs(process.argv.slice(2));
    runRelease({
      repoRoot: defaultRepoRoot,
      nextVersion: options.nextVersion,
      dryRun: options.dryRun,
    });
  }
}
