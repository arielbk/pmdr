import { createRequire } from "node:module";

/**
 * The CLI's own version.
 *
 * `../package.json` rather than a path relative to this file's directory: the
 * whole of `src` is bundled into `dist/index.js`, and that one relative path
 * lands on `apps/cli/package.json` from both `src/` and `dist/`. Anything
 * deeper resolves correctly in one and not the other.
 */
export function cliVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}
