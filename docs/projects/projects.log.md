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

---

## project-add-list — 2026-05-16

**Slice:** `project-add-list` — `pmdr project add` and `pmdr project list`

**Status:** done

**What was implemented:**
- `src/commands/project.ts`: `project` command with `add` and `list` sub-commands
- `validateAddName(name)` — trims, rejects `(unassigned)` sentinel, rejects names >100 chars, rejects empty
- `addProjectLogic(store, name)` — case-insensitive duplicate detection (throws `already exists`), delegates to `upsertProject`
- `formatProjectList(records, includeArchived)` — one project per line; appends `(archived)` marker when `includeArchived` is true
- `pmdr project list --include-archived` passes `includeArchived: true` to `listProjects`
- `pmdr project list --json` outputs `{ projects: [...] }`
- Wired `projectCmd` into `index.ts` sub-command map

**Tests:** 12 unit tests in `src/__tests__/project-add-list.test.ts` — all pass (112 total across all test files)

**Feedback loop result:** `vitest run` — 112/112 tests pass; `tsc --noEmit` — no errors; manual: duplicate add errors, canonical casing preserved, JSON output parses cleanly

**Notes:** esbuild linux-arm64 binary installed manually (same issue as projects-module iteration).
