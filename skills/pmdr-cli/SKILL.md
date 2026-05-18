---
name: pmdr-cli
description: Drives the `pmdr` pomodoro CLI non-interactively from an agent — start/pause/resume/stop a timer, check status, list today's completions, and manage projects. Use when the user mentions pmdr, pomodoros, "start a timer", "what's my status", project tracking, or asks to script work sessions in the terminal.
---

# pmdr CLI

A pomodoro timer CLI. Binary is `pmdr` (installed globally via pnpm). State lives in `~/.local/state/pmdr/`.

## Non-interactive contract

- Read commands (`status`, `today`, `project list`) accept `--json`. **Always prefer `--json`** when consuming output programmatically — the human format may change.
- `pmdr start` is interactive by default (prompts for project via `@clack/prompts`). To run from an agent, **always** pass `--project <name>` AND `--no-interactive`. The project will be auto-created if it doesn't exist.
- Errors → exit 1 with message on stderr. Success → exit 0.
- `pmdr` with no subcommand launches an Ink TUI — **never invoke this from an agent**; it requires a TTY and blocks.

## Commands

| Command | Purpose | Non-interactive form |
|---|---|---|
| `start` | Begin a pomodoro | `pmdr start --project NAME --duration 25m --no-interactive` |
| `pause` | Pause running timer | `pmdr pause` |
| `resume` | Resume paused timer | `pmdr resume` |
| `stop` | Stop & discard timer | `pmdr stop` |
| `status` | Current timer state | `pmdr status --json` |
| `today` | Today's completions | `pmdr today --json [--project NAME]` |
| `project add NAME` | Create project | `pmdr project add "Work"` |
| `project list` | List projects | `pmdr project list --json [--include-archived]` |
| `project rename OLD NEW` | Rename | `pmdr project rename "old" "new"` |
| `project archive NAME` | Archive | `pmdr project archive NAME` |
| `project unarchive NAME` | Unarchive | `pmdr project unarchive NAME` |

`--duration` accepts `25m`, `90s`, `1500ms`, etc. Default is 25m.

## Important gotchas

- **`pmdr start` blocks**: after initializing the timer, the foreground process runs a countdown loop that only resolves when the timer completes, is stopped externally, or the state file is cleared. From an agent, run it with `run_in_background: true` (Bash) — or call only the state-setup logic by invoking `start` then immediately backgrounding. Don't `await` it in a foreground tool call.
- **Only one timer at a time**: `start` errors if running or paused. Check `pmdr status --json` first; call `pmdr stop` if you need to reset.
- **Reserved name**: `"(unassigned)"` cannot be used as a project name.
- **State file location**: `~/.local/state/pmdr/state.json` (current timer) and `~/.local/state/pmdr/completions.json` (history). Safe to read; don't write directly — use the CLI.

## JSON shapes

```jsonc
// pmdr status --json
{ "state": "idle" }
{ "state": "running" | "paused", "remainingMs": 1234567, "duration": 1500000, "startedAt": 1700000000000 }

// pmdr today --json
{
  "groups": [
    { "project": "Work", "pomodoros": 2, "totalMs": 3000000, "entries": [{ "completedAt": 1700000000000, "durationMs": 1500000, "project": "Work" }] }
  ],
  "total": { "pomodoros": 2, "totalMs": 3000000 }
}

// pmdr project list --json
{ "projects": [{ "name": "Work", "archived": false }] }
```

## Typical agent flow

```sh
# 1. Check nothing's running
pmdr status --json

# 2. Ensure project exists (idempotent — start auto-creates)
pmdr project list --json

# 3. Start a 25-minute session, backgrounded
pmdr start --project "Deep Work" --duration 25m --no-interactive &

# 4. Later, summarize the day
pmdr today --json
```

## Backdating ("I started N minutes ago")

When the user says they started a pomodoro **N minutes ago** but never ran `pmdr start`, you can land the completion at the correct wall-clock time by shortening the duration:

```sh
pmdr start --project "<name>" --duration $((25 - N))m --no-interactive
```

Formula: `--duration = default_focus_minutes − N`. The default focus length is **25 minutes**, so:

- "I started 5 minutes ago" → `--duration 20m`
- "I started 10 minutes ago" → `--duration 15m`

Rules:
- **Never exceed the default focus length** (do not pass `--duration 25m` or longer when backdating — that's a fresh timer, not a backdate).
- If `N ≥ 25`, the block has already conceptually ended. Don't backdate — log the time manually or treat the request as a fresh start.
- If `N` is missing or ambiguous, ask the user to confirm before starting.

This rule lives in the skill, not the CLI: the CLI does not know about backdating, it only knows the requested `--duration`.

## Source

Repo: `/Users/arielbk/Projects/side/pmdr` — CLI at `apps/cli/src/`. Run `pmdr --help` or `pmdr <cmd> --help` to confirm flags after upgrades.
