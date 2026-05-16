# pmdr Projects

Vertical slices for adding the `project` attribution concept to the `pmdr` CLI: a `projects.json` store, a `project` CRUD surface, project-aware `start` and `today`, and a Clack picker for the interactive case.

## Slices

### `projects-module` — projects file + lookup/upsert/archive

**Status:** done

**Outside-in:** A module exposing `readProjects()`, `writeProjects(p)`, `findProject(name)` (case-insensitive, trims whitespace, rejects the reserved `(unassigned)` sentinel), `upsertProject(name)` (idempotent; preserves first-seen casing; returns the canonical record), `archiveProject(name)`, `unarchiveProject(name)`, `listProjects({ includeArchived })`. Storage at `~/.local/state/pmdr/projects.json` with shape `{ projects: [{ name, archived, createdAt }] }`; absent file ⇒ empty list; atomic writes (temp + rename).

**Feedback loop:** Unit tests covering: (1) `findProject` is case-insensitive and whitespace-trimming, and refuses `(unassigned)`; (2) `upsertProject` is idempotent on case variants and preserves the first-seen casing; (3) `archiveProject` / `unarchiveProject` flip the flag and are no-ops when the project doesn't exist (or error — agent's choice, but consistent); (4) atomic write — partial writes don't corrupt the file.

**Human checkpoint:** no

**Depends on:** none

---

### `project-add-list` — `pmdr project add` and `pmdr project list`

**Status:** not-started

**Outside-in:** `pmdr project add <name>` creates a project (errors on duplicate via case-insensitive lookup, errors on the `(unassigned)` sentinel, errors on names >100 chars). `pmdr project list` prints non-archived projects, one per line, in creation order. `pmdr project list --include-archived` includes archived ones with an `(archived)` marker. `pmdr project list --json` prints `{ projects: [{ name, archived, createdAt }] }`.

**Feedback loop:** Manual: `pmdr project add pmdr` then `pmdr project add PMDR` errors. `pmdr project add "side blog"` succeeds. `pmdr project list` shows both. `pmdr project list --json | jq .` parses cleanly. Inspect `~/.local/state/pmdr/projects.json` to confirm the canonical casing was preserved.

**Human checkpoint:** no

**Depends on:** projects-module

---

### `log-with-project` — log entries carry a project

**Status:** not-started

**Outside-in:** `appendCompletion({ completedAt, durationMs, project })` requires the `project` field. `readToday()` returns entries grouped by project name; entries from the existing log (no `project` field) group under the reserved `(unassigned)` key.

**Feedback loop:** Unit tests: (1) `appendCompletion` writes a JSONL line including `project`; calling without `project` is a type error or runtime guard. (2) `readToday` on a mixed log (some entries with `project`, some without) returns groups keyed by project name with `(unassigned)` collecting the legacy entries. (3) `readToday` only includes today's entries (local-date boundary, regression check on the v1 behaviour).

**Human checkpoint:** no

**Depends on:** projects-module

---

### `start-with-project` — `pmdr start --project <name>` (non-interactive)

**Status:** not-started

**Outside-in:** `pmdr start --project <name>` starts a pomodoro attributed to `<name>`, auto-creating the project if it doesn't exist (via `upsertProject`). The state file shape gains a `project: string` field. `pmdr start` with no `--project` and no TTY exits with a clear error: `no --project specified and stdout is not a TTY`. Eager completion (renderer hits zero) and lazy completion (another command observes expired state) both write the log entry with the captured `project`.

**Feedback loop:** Manual: `pmdr start --project pmdr --duration 5s` runs to completion and the log entry contains `"project": "pmdr"`. `pmdr start --project new-thing --duration 5s` auto-creates `new-thing` (verify in `projects.json`). Piping `pmdr start` so stdout is not a TTY (e.g. `pmdr start | cat`) errors out with the documented message. Two-terminal: start with `--project X`, kill T1 mid-run, run `pmdr status` in T2 — lazy completion writes a log entry attributed to `X`.

**Human checkpoint:** no

**Depends on:** projects-module, log-with-project

---

### `today-grouped` — `pmdr today` groups by project

**Status:** not-started

**Outside-in:** `pmdr today` prints groups by project with per-project pomodoro count and total time, followed by a grand total. `pmdr today --project <name>` filters to a single group. `pmdr today --json` returns `{ groups: [{ project, pomodoros, totalMs, entries: [...] }], total: { pomodoros, totalMs } }`. Legacy entries without `project` appear under `(unassigned)`.

**Feedback loop:** Unit tests against a fixture log: (1) grouping math matches expected per-group and grand totals; (2) `--project X` returns only group `X`; (3) `--json` shape matches the contract; (4) legacy entries land under `(unassigned)`. Manual: after `start-with-project`, run a couple of short pomodoros across two projects and verify the rendered output matches the PRD example layout.

**Human checkpoint:** no

**Depends on:** log-with-project

---

### `project-rename` — `pmdr project rename <old> <new>`

**Status:** not-started

**Outside-in:** `pmdr project rename <old> <new>` updates `projects.json` (case-insensitive match on `<old>`, canonical-casing write of `<new>`) and rewrites every entry in `log.jsonl` whose `project` matches `<old>` case-insensitively to `<new>`. Errors if `<old>` does not exist; errors if `<new>` already exists as a distinct project (use case-insensitive collision check). Reserved sentinel `(unassigned)` is not a valid `<old>` or `<new>`.

**Feedback loop:** Unit tests: (1) rename updates `projects.json` and rewrites all matching log entries with the canonical casing of `<new>`; (2) idempotent when no log entries reference `<old>`; (3) rejects rename to an existing project (case-insensitive); (4) rejects `(unassigned)` on either side. Manual: create two projects, log a pomodoro under each, rename one, confirm `pmdr today` reflects the new name.

**Human checkpoint:** no

**Depends on:** project-add-list, log-with-project

---

### `project-archive` — `pmdr project archive` / `unarchive`

**Status:** not-started

**Outside-in:** `pmdr project archive <name>` sets `archived: true` on the project. `pmdr project unarchive <name>` flips it back. Archived projects are hidden from `pmdr project list` by default but shown with `--include-archived`. Historical log entries attributed to an archived project still render in `today` (archive is presentation-only on the project list).

**Feedback loop:** Manual: add a project, log a pomodoro to it, archive it, run `pmdr project list` (hidden) and `pmdr project list --include-archived` (shown with marker). Confirm `pmdr today` still renders the historical entry under the archived project name. Unit: archive/unarchive flips the flag in the store.

**Human checkpoint:** no

**Depends on:** project-add-list

---

### `start-picker` — Clack picker for the interactive TTY case

**Status:** not-started

**Outside-in:** `pmdr start` with no `--project` in a TTY shows a Clack single-select picker listing non-archived projects in creation order plus a final "new…" option. Selecting "new…" opens a free-form text input. The chosen name is passed through `upsertProject` and the timer starts as if `--project` had been supplied. `pmdr start --no-interactive` forces the no-TTY error path even when stdout is a TTY.

**Feedback loop:** Human-in-the-loop, non-blocking. After all prior slices ship, the human runs `pmdr start` in a real terminal, confirms the picker renders existing projects + the "new…" option, picks one, and verifies the pomodoro starts attributed correctly. Repeats with the "new…" path to confirm a free-form name auto-creates the project. Verifies `pmdr start --no-interactive` errors out even in a TTY.

**Human checkpoint:** yes

**Depends on:** start-with-project, project-archive
