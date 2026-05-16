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

## start-with-project — 2026-05-16

**Slice:** `start-with-project` — `pmdr start --project <name>` (non-interactive)

**Status:** done

**What was implemented:**
- `StateRecord` in `state.ts`: added optional `project?: string` field (backward-compat for reading legacy state files)
- `finalizeIfExpired` in `state.ts`: now reads `file.project ?? "(unassigned)"` instead of hardcoded `"(unassigned)"` — both eager and lazy completion paths carry the project from state
- `initTimer` in `commands/start.ts`: added required `project: string` parameter; writes project into state file
- `start` command: added `--project <name>` arg; added `--no-interactive` flag; when no `--project` and (`!process.stdout.isTTY` or `--no-interactive`), exits with `no --project specified and stdout is not a TTY`; calls `upsertProject(projectArg)` to auto-create the project if it doesn't exist, using canonical casing
- `pause.ts`: no changes needed — `store.writeState({ ...file!, pausedAt: now })` naturally preserves the `project` field via spread
- Updated `__tests__/start.test.ts`: all `initTimer` calls updated to include `project: "test-proj"`

**Tests:** 7 unit tests in `src/__tests__/start-with-project.test.ts` — all pass (129 total across all test files)

**Feedback loop result:** `vitest run` — 129/129 tests pass; `tsc --noEmit` — no errors

**Notes:** `project` on `StateRecord` is optional for backward compatibility with pre-existing state files; `finalizeIfExpired` falls back to `"(unassigned)"` for those. The `--no-interactive` flag forces the no-TTY error path even in a real TTY, as required by the slice spec.

---

## today-grouped — 2026-05-16

**Slice:** `today-grouped` — `pmdr today` groups by project

**Status:** done

**What was implemented:**
- `TodayGroup` interface: `{ project, pomodoros, totalMs, entries }`
- `TodayGroupedResult` interface: `{ groups: TodayGroup[], total: { pomodoros, totalMs } }`
- `getTodayGrouped({ store, now, project? })`: calls `store.readToday(now)` (which groups and finalizes), optionally filters to a single project, computes per-group and grand totals
- `formatTodayGrouped(result)`: renders each group as `<project>: N pomodoros, Xm` followed by indented timestamps, with a `Total: N pomodoros, Xm` grand total line
- Updated `today` command: added `--project <name>` arg; text output uses `formatTodayGrouped`; JSON output shape is now `{ groups, total }` per spec
- Preserved legacy `getToday`, `filterToday`, `TodayResult`, `formatToday` exports so existing tests continue to pass

**Tests:** 13 unit tests in `src/__tests__/today-grouped.test.ts` — all pass (142 total across all test files)

**Feedback loop result:** `vitest run` — 142/142 tests pass; `tsc --noEmit` — no errors

**Notes:** `readToday()` in `state.ts` was already implemented by the `log-with-project` slice and returns `Record<string, CompletionRecord[]>` grouped by project, so this slice is a thin consumer of that API.

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

---

## project-archive — 2026-05-16

**Slice:** `project-archive` — `pmdr project archive` / `unarchive`

**Status:** done

**What was implemented:**
- `archiveProjectLogic(store, name)` exported from `commands/project.ts`: validates name is not `(unassigned)` sentinel, throws `not found` if project doesn't exist, calls `store.archiveProject`, returns updated record with `archived: true`
- `unarchiveProjectLogic(store, name)` exported from `commands/project.ts`: same validation, calls `store.unarchiveProject`, returns updated record with `archived: false`
- `archiveCmd` sub-command: `pmdr project archive <name>` — calls `archiveProjectLogic`, prints confirmation
- `unarchiveCmd` sub-command: `pmdr project unarchive <name>` — calls `unarchiveProjectLogic`, prints confirmation
- Both sub-commands wired into the `project` command's `subCommands` map
- Archived project visibility is already handled by `listProjects({ includeArchived })` and `formatProjectList` (from `projects-module` and `project-add-list` slices); archive is presentation-only on the list — historical log entries still render in `pmdr today`

**Tests:** 10 unit tests in `src/__tests__/project-archive.test.ts` — all pass (165 total across all test files)

**Feedback loop result:** `npm test` — 165/165 tests pass; `tsc --noEmit` — no errors

**Notes:** The underlying `archiveProject`/`unarchiveProject` in `projects.ts` are no-ops when the project doesn't exist; the command-level logic adds the "not found" error for the CLI surface. The `(unassigned)` sentinel guard is consistent with the other command-level logic functions.

---

## project-rename — 2026-05-16

**Slice:** `project-rename` — `pmdr project rename <old> <new>`

**Status:** done

**What was implemented:**
- `renameProject(oldName, newName)` added to `createProjectsModule` in `projects.ts`: case-insensitive match on `old`, writes canonical casing of `new`, throws if `old` not found, throws on case-insensitive collision with a distinct project, rejects `(unassigned)` on either side; module-level export added
- `rewriteCompletionProject(oldName, newName)` added to `createStateModule` in `state.ts`: reads all completions, rewrites entries where `project` matches `oldName` case-insensitively to `newName`'s canonical casing, atomically rewrites `completions.jsonl` via temp+rename; module-level export added
- `renameProjectLogic(projectsStore, stateStore, oldName, newName)` exported from `commands/project.ts`: calls `renameProject` first (errors propagate without touching the log), then `rewriteCompletionProject`
- `renameCmd` sub-command added to `commands/project.ts`, wired into `project` command as `rename`

**Tests:** 13 unit tests in `src/__tests__/project-rename.test.ts` — all pass (155 total across all test files)

**Feedback loop result:** `npm test` — 155/155 tests pass; `tsc --noEmit` — no errors

**Notes:** `renameProject` validates both sides for `(unassigned)` sentinel before touching the store. `rewriteCompletionProject` handles empty log gracefully (no-op). Error in `renameProject` prevents `rewriteCompletionProject` from running, keeping the log consistent with the projects store.
