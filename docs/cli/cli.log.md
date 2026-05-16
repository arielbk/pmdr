# CLI Implementation Log

---

## scaffold — 2026-05-16

**Slice:** `scaffold`
**Status:** done

**What was done:**
- Created `apps/cli/` package with citty as the CLI framework and tsup as the bundler.
- Defined all six subcommands (`start`, `pause`, `resume`, `stop`, `status`, `today`) as stub command files under `src/commands/`.
- Wired the main entry `src/index.ts` using `defineCommand` + `runMain` from citty, reading the version from `package.json`.
- Added `tsup.config.ts` with shebang banner (`#!/usr/bin/env node`) and ESM format.
- Added `"cli": "workspace:*"` to root `package.json` devDependencies so pnpm links the `pmdr` binary in `node_modules/.bin`.

**Feedback loop result:**
- `pnpm --filter cli build && pnpm --filter cli exec pmdr --help` — prints all 6 commands with descriptions ✓
- `pmdr --version` — prints `0.1.0` ✓
