---
name: pmdr-cli
description: Drives the `pmdr` pomodoro CLI non-interactively from an agent — start/pause/resume/stop a timer, check status, query completions and notes over a date range, and manage projects. Use when the user mentions pmdr, pomodoros, "start a timer", "what's my status", asks what they worked on over some period, project tracking, or asks to script work sessions in the terminal.
---

# pmdr CLI

A pomodoro timer CLI. Binary is `pmdr` (installed globally from npm: `npm install -g @arielbk/pmdr`). State lives in `~/.local/state/pmdr/`.

## Non-interactive contract

- Read commands (`status`, `log`, `today`, `project list`) accept `--json`. **Always prefer `--json`** when consuming output programmatically — the human format may change.
- `pmdr start` is interactive by default (prompts for project via `@clack/prompts`). To run from an agent, **always** pass `--project <name>` AND `--no-interactive`. The project will be auto-created if it doesn't exist.
- Errors → exit 1 with message on stderr. Success → exit 0.
- `pmdr` with no subcommand is a router: it runs `pmdr setup` on a fresh install *if* stdin and stdout are a TTY, attaches to a session already running, or otherwise starts one. From an agent it never onboards and never blocks — but prefer the explicit subcommands, so what you asked for does not depend on the machine's state.

## Commands

| Command | Purpose | Non-interactive form |
|---|---|---|
| `start` | Begin a pomodoro | `pmdr start --project NAME --duration 25m --no-interactive [--force] [--detach]` |
| `pause` | Pause running timer | `pmdr pause` |
| `resume` | Resume paused timer | `pmdr resume` |
| `stop` | Stop & discard timer | `pmdr stop` |
| `status` | Current timer state | `pmdr status --json` |
| `log` | Completions + notes over a date range | `pmdr log [--from YYYY-MM-DD] [--to YYYY-MM-DD] --json [--project NAME]` |
| `today` | Alias for today's range | `pmdr today --json [--project NAME]` |
| `project add NAME` | Create project | `pmdr project add "Work"` |
| `project list` | List projects | `pmdr project list --json [--include-archived]` |
| `project rename OLD NEW` | Rename | `pmdr project rename "old" "new"` |
| `project archive NAME` | Archive | `pmdr project archive NAME` |
| `project unarchive NAME` | Unarchive | `pmdr project unarchive NAME` |

`--duration` accepts `25m`, `90s`, `1500ms`, etc. Default is 25m.

## Querying history with `log`

`pmdr log` is the one history command. `--from` and `--to` are **inclusive local
dates** in `YYYY-MM-DD` form, and the range covers whole local days — a completion
at `00:00:00` on `from` and one at `23:59:59` on `to` are both inside.

**An omitted endpoint is unbounded. No exceptions.**

| Invocation | Window |
|---|---|
| `pmdr log --from A --to B --json` | A through B |
| `pmdr log --from A --json` | A through today |
| `pmdr log --to B --json` | earliest record on file through B |
| `pmdr log --json` | the entire history |

The payload always echoes the resolved `from`/`to`, so you can restate the window
you actually got and spot gaps. On a completely empty install both collapse onto
today rather than reaching back to the epoch.

**You resolve the phrase, not `pmdr`.** The CLI only understands dates. When the
user says "yesterday", "last week", "this month" or "since Monday", work out the
concrete dates yourself, **state the range back to the user** in your answer
("2026-08-01 to 2026-08-07"), and ask first if the phrase is genuinely ambiguous
(is "last week" the previous calendar week, or the last seven days?). Never guess
silently — the user cannot see the window you picked unless you say it.

**Errors vs. empty results.** A bad invocation exits 1 with an explanation on
stderr and writes *nothing* to stdout; a valid query with no matches exits 0 with
an empty `days` array. Never conflate them — report a bad range as an error, not
as "you did no work".

```sh
$ pmdr log --from not-a-date
Invalid --from date "not-a-date" — expected YYYY-MM-DD     # exit 1, stdout empty

$ pmdr log --from 2026-08-07 --to 2026-08-03
Empty range: from 2026-08-07 is after to 2026-08-03        # exit 1, stdout empty
```

`--project NAME` filters **completions** across every day in the range; notes are
*not* filtered, so a project-scoped query still surfaces every note in the window.
Pass `--project "(unassigned)"` to match completions with no project.

Days with neither completions nor notes are omitted from `days` entirely — a day
present with an empty `groups` array but populated `notes` means notes only.

`start` flags worth knowing:
- `--force` — discard any running/paused timer before starting. Saves a separate `pmdr stop`.
- `--detach` — initialize the timer and exit immediately; skips the countdown render. Prefer this over `&` backgrounding when you just want the timer running.

## Important gotchas

- **`pmdr start` only blocks on a terminal**: the foreground countdown loop is skipped when stdout is not a TTY — an agent's `start` initializes the timer, prints one line pointing at `pmdr status --json`, and exits 0. Pass `--detach` to get the same behaviour silently, and on a real terminal.
- **Only one timer at a time**: `start` errors if running or paused. Check `pmdr status --json` first; call `pmdr stop` if you need to reset.
- **Reserved name**: `"(unassigned)"` cannot be used as a project name.
- **State files** under `~/.local/state/pmdr/` (safe to read; don't write — use the CLI):
  - `state.json` — current timer record (per-timer `id` uuid).
  - `completions.jsonl` — finished focus blocks, one JSON per line. Each row carries the timer's `id`.
  - `events.jsonl` — append-only `start`/`pause`/`resume`/`stop` log. Only relevant for daily-review / interruption analysis — see [EVENT-LOG.md](EVENT-LOG.md).

## JSON shapes

```jsonc
// pmdr status --json
{ "state": "idle" }
{ "state": "running" | "paused", "remainingMs": 1234567, "duration": 1500000, "startedAt": 1700000000000 }

// pmdr log --json  (and pmdr today --json — same shape, a single-day range)
{
  "from": "2026-08-05",                  // resolved window, echoed back
  "to": "2026-08-06",
  "days": [                              // ascending; days with no data omitted
    {
      "date": "2026-08-05",
      "groups": [
        { "project": "Work", "pomodoros": 2, "totalMs": 3000000,
          "entries": [{ "completedAt": 1785913200000, "durationMs": 1500000, "project": "Work", "id": "uuid…" }] }
      ],
      "total": { "pomodoros": 2, "totalMs": 3000000 },
      "notes": [                         // ascending by time; [] when none
        { "text": "slack derail", "at": 1785917700000, "sessionId": "", "project": "Work", "phase": "focus" }
      ]
    },
    { "date": "2026-08-06", "groups": [ /* … */ ], "total": { "pomodoros": 1, "totalMs": 1500000 }, "notes": [] }
  ],
  "total": { "pomodoros": 3, "totalMs": 4500000 }   // across the whole range
}

// pmdr project list --json
{ "projects": [{ "name": "Work", "archived": false }] }
```

Without `--json`, `log` and `today` print one block per day under an unconditional
date header. The grand `Total:` line appears **only** when the resolved range spans
more than one day, so `pmdr today` never prints one. An empty range prints
`Nothing recorded from 2026-08-05 to 2026-08-06` rather than nothing at all.

```
$ pmdr log --from 2026-08-05 --to 2026-08-06
2026-08-05
  Work: 2 pomodoros, 50m
    9:00
    9:30
  Notes:
    10:15  slack derail

2026-08-06
  Side: 1 pomodoro, 25m
    14:00

Total: 3 pomodoros, 75m
```

For the `events.jsonl` shape and how to read interruption signals, see [EVENT-LOG.md](EVENT-LOG.md).

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

# 5. Or a range — resolve the dates yourself and state them back
pmdr log --from 2026-08-01 --to 2026-08-07 --json
```

## Further reading

- [EVENT-LOG.md](EVENT-LOG.md) — read when summarising a day's flow / interruptions / abandoned timers.
- [BACKDATING.md](BACKDATING.md) — read when the user says "I started N minutes ago" and never ran `pmdr start`.

## Source

Repo: `/Users/arielbk/Projects/side/pmdr` — CLI at `apps/cli/src/`. Run `pmdr --help` or `pmdr <cmd> --help` to confirm flags after upgrades.
