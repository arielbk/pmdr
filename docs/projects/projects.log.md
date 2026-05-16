# Projects Feature — Implementation Log

---

## projects-module — 2026-05-16

**Slice:** `projects-module` — projects file + lookup/upsert/archive

**Status:** done

**What was implemented:**
- `src/projects.ts`: `createProjectsModule(stateDir)` factory (mirrors `createStateModule` pattern)
- Storage at `~/.local/state/pmdr/projects.json` with shape `{ projects: [{ name, archived, createdAt }] }`
- `readProjects()` — reads file, returns empty list if absent
- `writeProjects(p)` — atomic write via temp file + rename
- `findProject(name)` — case-insensitive, trims whitespace, returns null for `(unassigned)` sentinel
- `upsertProject(name)` — idempotent; preserves first-seen casing; throws on `(unassigned)` sentinel
- `archiveProject(name)` / `unarchiveProject(name)` — flip flag; no-op when project not found
- `listProjects({ includeArchived })` — preserves creation order; filters archived by default
- Module-level prod singleton exports matching `state.ts` pattern

**Tests:** 22 unit tests in `src/__tests__/projects.test.ts` — all pass

**Feedback loop result:** `vitest run` — 100/100 tests pass across all test files; `tsc --noEmit` — no errors

**Notes:** Environment required installing linux-arm64 native bindings for rollup/esbuild (pnpm lockfile had darwin-arm64 binaries only). Binaries installed to node_modules manually for the test run.
