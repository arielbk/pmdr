## `config-read` — 2026-06-04 01:03:41

**Status:** done
**Summary:** Added effective config reads for the CLI, including defaults, partial-file merging, per-key invalid-value fallback, `pmdr config --json`, and `pmdr config get <key>`.
**Deviations:** none.
**Handoff:** Config reads use `XDG_CONFIG_HOME/pmdr/config.json` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/pmdr/config.json`. The public read module currently preserves only known config keys; the later `config-set` slice must preserve unknown keys during read-modify-write.

## `config-set` — 2026-06-04 01:08:02

**Status:** done
**Summary:** Added validated `pmdr config set <key> <value>` support with atomic config-file writes, set-then-get round trips, invalid-value rejection before write, and unknown-key preservation during read-modify-write.
**Deviations:** Added `apps/cli/eslint.config.mjs` so the CLI package lint feedback loop can run; broader `pnpm --filter cli test` still fails on unrelated existing TUI/help snapshot/color assertions outside this slice.
**Handoff:** Slice feedback passed with `pnpm --filter cli test -- config.test.ts`, `pnpm --filter cli check-types`, and `pnpm --filter cli lint` (lint exits 0 with existing warnings).
