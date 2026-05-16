# PRD: Projects

## Problem Statement

The v1 `pmdr` CLI logs completed pomodoros as a flat list of `{ completedAt, durationMs }` entries. Without a way to attribute each pomodoro to *what* I was working on, `pmdr today` degrades into a list of timestamps that tells me I worked five pomodoros but not on what. End-of-day reflection ("I did 2.5h of deep work on X, Y, Z") is impossible from the log alone.

Agents that drive `pmdr` need to create and reference these attribution buckets directly from the command line, without an interactive prompt, so they can start timers on the user's behalf and report back grouped totals.

## Solution

Introduce a `project` concept to the CLI. Every completed pomodoro is attributed to exactly one project. Projects are managed via a small CRUD surface (`pmdr project add|list|rename|archive`), or created implicitly when a new name is first passed to `pmdr start --project <name>`.

Humans starting a pomodoro in a terminal get an interactive picker (Clack-style) listing existing projects plus a free-form "new…" option. Agents and scripts pass `--project <name>` to bypass the picker; if the project doesn't exist, it's auto-created. If no `--project` is given and stdout is not a TTY, `start` errors out instead of silently defaulting.

`pmdr today` groups entries by project, with a per-project pomodoro count and total deep-work time, plus a grand total and the elapsed-time context. Old log entries that pre-date the projects feature are rendered under an `(unassigned)` group.

## User Stories

1. As a user, I want `pmdr project add <name>` to create a project explicitly, so I can pre-seed projects before starting timers.
2. As a user, I want `pmdr project list` to show all projects (including archived, with a flag), so I can see what attribution buckets exist.
3. As a user, I want `pmdr project rename <old> <new>` to rename a project and update every historical log entry that referenced the old name, so a typo doesn't permanently fragment my history.
4. As a user, I want `pmdr project archive <name>` to hide a project from the default picker and `list` output, so finished or stale projects stop cluttering my flow.
5. As a user in a terminal, I want `pmdr start` with no `--project` flag to show an interactive picker of existing (non-archived) projects plus a free-form "new…" option, so I can pick or create a project in one gesture.
6. As an agent, I want `pmdr start --project <name>` to start a pomodoro non-interactively, auto-creating the project if it doesn't exist, so I never need to do a list/check/add dance first.
7. As a script author, I want `pmdr start` with no `--project` and no TTY to exit with a clear error, so misconfigured automation fails loudly instead of producing unattributed entries.
8. As a user, I want project names to be case-insensitive for lookup but case-preserving for display, so `pmdr`, `Pmdr`, and `PMDR` all resolve to the same project rendered the way I first typed it.
9. As a user, I want `pmdr today` to group completed pomodoros by project with a per-project count and total time, plus a grand total and the elapsed-time context, so end-of-day reflection is one command.
10. As an agent, I want `pmdr today --json` to expose the project grouping in structured form, so I can read attributed totals programmatically.
11. As a user, I want pre-existing log entries from before this feature to render under an `(unassigned)` group in `today` without breaking anything, so I don't need a migration step on my own dev data.
12. As a user, I want `pmdr start --project <new-name>` to auto-create the project on first use, mirroring the free-form picker entry, so humans and agents share the same lifecycle.

## Implementation Decisions

**Storage.** A new file `~/.local/state/pmdr/projects.json` alongside `state.json` and `log.jsonl`. Shape:

```
{ projects: [{ name: string, archived: boolean, createdAt: ISO8601 }] }
```

Atomic writes (temp file + rename), mirroring the existing `state` module. Absent file ⇒ empty project list. The `name` field is the canonical display string; lookups are case-insensitive.

**Log shape.** Append a `project: string` field to new entries in `log.jsonl`. Existing entries without the field render as `(unassigned)` — no migration. `(unassigned)` is a reserved sentinel; `project add` rejects it.

**Identity & rules.** Case-insensitive lookup, case-preserving storage. Names are trimmed of leading/trailing whitespace, allow any printable characters including spaces, capped at 100 chars. Reserved name: `(unassigned)`.

**`projects` module.** Pure read/write/derivation for `projects.json`:

- `readProjects()` → `{ projects: Project[] }`
- `writeProjects(p)` — atomic
- `findProject(name)` — case-insensitive lookup, returns canonical record or null
- `upsertProject(name)` — case-insensitive lookup; creates with the supplied casing if new; returns canonical name
- `renameProject(old, new)` — updates the projects file; the caller is responsible for rewriting the log
- `archiveProject(name)`, `unarchiveProject(name)`
- `listProjects({ includeArchived })`

**`log` module additions.**

- `appendCompletion({ completedAt, durationMs, project })` — `project` now required for new entries.
- `rewriteLogProject(oldName, newName)` — rewrites `log.jsonl` so any entry whose `project` matches `oldName` (case-insensitive) is replaced with `newName`. Used by `project rename`.
- `readToday()` — entries grouped by project name; entries without `project` grouped under `(unassigned)`.

**`commands/project.ts`.** New Citty subcommand with sub-subcommands `add`, `list`, `rename`, `archive`. Thin wrappers over the `projects` module.

**`start` changes.** A new `--project <name>` flag. Behaviour:

- Flag passed → call `upsertProject(name)`, write state with `project` baked in, run renderer.
- Flag absent + TTY → show Clack picker (existing non-archived projects + free-form "new…" entry), then `upsertProject` the chosen name.
- Flag absent + no TTY → error: "no --project specified and stdout is not a TTY".
- `--no-interactive` flag forces the error path even in a TTY.

The `project` attribution is captured at start-time and travels through to the log on completion (both eager — renderer hits zero — and lazy — another command observes expired state). The state file shape gains a `project: string` field.

**`today` changes.** Default human output groups by project:

```
pmdr        3 pomodoros  1h 15m
  09:12  25m
  10:05  25m
  14:30  25m
side-blog   2 pomodoros  50m
─────────────────────────────
total       5 pomodoros  2h 05m
```

`--json` exposes the grouping:

```
{
  groups: [{ project: string, pomodoros: number, totalMs: number, entries: [...] }],
  total: { pomodoros: number, totalMs: number }
}
```

`--project <name>` filters to a single group.

**Picker.** Clack (`@clack/prompts`). Single select with existing projects + a "new…" option that opens a free-form text input.

**TTY detection.** `process.stdout.isTTY`.

**Out-of-band assumption.** Project rename is a small operation on a personal log file; rewriting `log.jsonl` in place (write to temp + rename) is fine. No expectation of concurrent writers beyond what the existing state file already tolerates.

## Testing Decisions

Following the v1 pattern, valuable tests target pure data operations and the file contract. The Clack picker and Citty wiring are not unit-tested.

- **Projects module.** Table-driven tests for `findProject` (case-insensitive lookup, trimming, the `(unassigned)` reserved name), `upsertProject` (idempotent, preserves first-seen casing), `archiveProject` / `unarchiveProject`, and atomic write.
- **`renameProject` + `rewriteLogProject` together.** Rename updates `projects.json` and rewrites all matching log entries (case-insensitive match, canonical-casing write). Idempotent on a name with no entries.
- **`log` module.** `appendCompletion` requires `project`. `readToday` groups by project; entries without a `project` field group under `(unassigned)`.
- **`start` flag handling.** Unit-level: given `{ flag, isTTY }`, the start path chooses the right branch (use flag / picker / error). The picker call itself is mocked.
- **Lazy completion attributes correctly.** An expired state file containing `project: "X"` produces a log entry tagged `X`.

Human verification (two-terminal, manual) covers picker rendering and end-to-end flow against the done condition.

## Out of Scope

- Tags (any second axis of attribution beyond projects).
- `project delete` and `project merge`.
- A default-project config (the "I don't want to think" escape hatch).
- Calendar integration, agent-led daily planning, end-of-day plan-vs-actual comparison, pattern learning. These are separate systems that sit on top of this data.
- Date-range reporting (`--since`, `--week`, streaks).
- Migration of pre-existing log entries to a real project. They stay as `(unassigned)`.
- Project metadata beyond name + archived + createdAt (no colour, description, tags, parent/child).
- Per-project default duration.
- Changing the project of an in-flight pomodoro (no `pmdr project switch`).
- `--json` on `project` subcommands; only `today` and `status` are agent-readable surfaces.

## Open Questions

- Does `pmdr status` need a `project` field? Lean yes for `--json` (cheap, agent-useful); confirm.
- Should `project list --json` exist for agents that want to discover projects without parsing human output? Lean yes — it's the cheapest way to make the agent flow first-class. Confirm.
- Should `project archive` of the project that's currently running be allowed, blocked, or warn? Lean: allowed, since rendering the running timer doesn't depend on archive state.
