import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Filenames inside the bundled-app directory shipped in the npm package. */
export const BUNDLED_APP_ZIP = "pmdr-app.zip";
export const BUNDLED_APP_METADATA = "pmdr-app.json";

export type BundledApp =
  | { present: true; zipPath: string; version: string }
  | { present: false; reason: string };

/**
 * Directory the published package keeps the app zip in, resolved relative to
 * this module. Both `src/` and `dist/` sit one level under the package root,
 * so the same relative hop works for tests and for the built CLI.
 */
export function bundledAppDir(): string {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), "bundled-app");
}

function readVersion(metadataPath: string): string | null {
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

export function createBundledAppModule(bundleDir: string = bundledAppDir()) {
  const zipPath = join(bundleDir, BUNDLED_APP_ZIP);

  return {
    locate(): BundledApp {
      if (!existsSync(zipPath)) {
        return { present: false, reason: "no bundled app zip in this install" };
      }
      const version = readVersion(join(bundleDir, BUNDLED_APP_METADATA));
      if (version === null) {
        return {
          present: false,
          reason: "bundled app zip has no readable version metadata",
        };
      }
      return { present: true, zipPath, version };
    },
  };
}
