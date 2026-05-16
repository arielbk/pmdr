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

## log-with-project — 2026-05-16

**Slice:** `log-with-project` — log entries carry a project

**Status:** done

**What was implemented:**
- `CompletionRecord` in `state.ts`: added optional `project?: string` field (backward-compat for reading legacy log entries)
- `CompletionWrite` type: exported type alias with `project: string` required — calling `appendCompletion` without `project` is a TypeScript type error
- `appendCompletion(record: CompletionWrite)`: updated to require `project`; existing `finalizeIfExpired` caller passes `"(unassigned)"` as interim default (will be overridden by `start-with-project`)
- `readToday(now: number): Record<string, CompletionRecord[]>`: new method on `createStateModule` — calls `finalizeIfExpired`, filters to local-date boundary, groups by `entry.project ?? "(unassigned)"`. Also exported as module-level prod singleton.
- Updated existing `appendCompletion` callers in `state.test.ts` and `today.test.ts` to pass `project: "(unassigned)"`

**Tests:** 10 unit tests in `src/__tests__/log-with-project.test.ts` — all pass (122 total across all test files)

**Feedback loop result:** `vitest run` — 122/122 tests pass; `tsc --noEmit` — no errors

**Notes:** `readToday` result is `Record<string, CompletionRecord[]>` keyed by project name; `today-grouped` and `start-with-project` slices will consume this. Legacy JSONL entries with no `project` field land under `"(unassigned)"` key.

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
