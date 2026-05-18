# PRD: Event Log & Late Project Attribution

## Problem Statement

At end of day, when an agent reviews focus output, it can only see "N pomodoros across M projects" derived from `completions.jsonl`. That misses the texture I actually care about for daily flow review — abandoned timers that suggest interruptions, pauses mid-block, and timers I started before I knew which project they belonged to. Three concrete pain points:

1. The interactive TUI's focus-block dots never fill up across a day — they reset every time the timer record is cleared (between focus → break, between sessions). The "x/8" fraction next to them implies a count that the implementation can't actually track.
2. `pmdr start` forces a project pick before the timer can begin, which gets in the way when I just want to start focusing and decide attribution later. Today the project is fixed at start time even though the underlying field is mutable.
3. Stopped (abandoned) timers vanish entirely — no record exists for "I worked on X for 12 minutes then bailed." That signal is exactly what I want to surface when reviewing the day.

## Solution

Three coordinated changes, all driven by the same goal of giving the daily-review agent a richer picture:

1. **Dots fix (visual-only).** The TUI dot row counts today's completed focus blocks read from `completions.jsonl`, so it accumulates across the day and survives gaps, restarts, and break transitions. Drop the "x/8" fraction next to the dots — it becomes purely visual.
2. **Late-binding project attribution.** `pmdr start` no longer forces a project picker. A timer can start with no project (recorded as `(unassigned)`). The project on the active timer record remains mutable via the existing `p` command. At expiry, the completion row uses whatever project the record carries *at that moment*.
3. **Append-only event log.** A new `events.jsonl` file captures `start`, `stop`, `pause`, and `resume` events. Each timer gets a uuid assigned at `start`; that uuid is persisted on `state.json`, on every event row, and on the resulting completion row, so the agent can join events to completions and reconstruct partial/abandoned work.

A fourth change lives outside the codebase: the `pmdr-cli` skill is updated so that agents know they can simulate a backdated start by passing a shorter `--duration` (e.g. user says "I started 10 min ago" → agent runs `pmdr start --duration 15m`). No code support for backdating is added.

## User Stories

1. As a user, I want the focus-block dots in the interactive TUI to fill up as I complete pomodoros through the day, so I get a true visual signal of progress.
2. As a user, I don't want a numeric fraction next to the dots, since the dots themselves communicate the count.
3. As a user, I want `pmdr start` to begin a timer without forcing me to pick a project, so I can capture focus time the moment I sit down and decide attribution later.
4. As a user, I want to assign or change the project on the running timer via the existing `p` command, so the project on record reflects what I actually worked on.
5. As a user, I want the completed pomodoro to be attributed to whichever project is assigned at expiry, so a mid-block reassignment is honoured.
6. As a user, I want stopped/abandoned pomodoros to leave a trace in the event log, so my daily review can surface interruption patterns.
7. As a user, I want pauses and resumes during a timer to be recorded, so the agent can tell when I was actually focused vs stepping away.
8. As an agent, I want each timer's events tied together by a stable id and joinable to its completion row, so I can reconstruct what happened on any given timer without inferring from timestamps.
9. As an agent reading the pmdr-cli skill, I want to know that I can simulate a backdated pomodoro by reducing `--duration`, so I can handle "I started X minutes ago" requests without new CLI flags.

## Implementation Decisions

**Late-binding project.** `pmdr start` accepts `--project` as today but no longer prompts when absent in interactive mode. When no project is supplied, the active record's `project` field is set to `(unassigned)`. The TUI project picker (`p`) continues to mutate the active record. `advancePhaseIfExpired` already uses `file.project ?? "(unassigned)"` when writing the completion row, so the existing code path already implements late-binding once the start-time picker is removed — this is mostly a deletion in `start.ts` plus dropping the picker invocation.

**Pomodoro uuid.** `StateRecord` gains a required `id: string` field (uuid v4) assigned at `pmdr start`. Every event row carries that id. The completion row gains a matching `id` field. Legacy records without an id are tolerated on read; a fresh id is generated on phase transition if missing.

**Event log file.** `~/.local/state/pmdr/events.jsonl`, append-only JSONL, atomic appends via the existing pattern. One event per line. Schema (per row):

```
{ "type": "start" | "stop" | "pause" | "resume",
  "at": <epoch ms>,
  "id": <pomodoro uuid>,
  "project": <string, optional, captured at event time> }
```

Events are emitted at:
- `start`: when `initTimer` writes the new record.
- `pause`: when `pause` mutates `pausedAt`.
- `resume`: when `resume` clears `pausedAt`.
- `stop`: when `stop` clears the state file without a completion (i.e. an unfinished timer). Expiry does *not* emit a `stop` event — the completion row is the record of a finished timer.

The event log is purely additive. `completions.jsonl` keeps its current shape (plus the new `id` field) and remains the canonical record of finished focus blocks.

**Dot counter.** `CountdownView` derives the dot count from `readToday(now)`, summing the number of focus completions for today. The "x/8" `<Text dimColor>` block is removed. `DEFAULT_FOCUS_GOAL` becomes the visual cap only (8 dots max, no fraction).

The `completedFocusBlocks` field on `StateRecord` is no longer load-bearing for the TUI display, but is still used by `computeBreakDurationMs` to decide long-vs-short break cadence. It stays.

**Skill doc update.** `skills/pmdr-cli/SKILL.md` gets a short section under usage describing the backdating pattern: "If the user says they started N minutes ago, pass `--duration (default − N)m` so the completion lands at the right wall-clock time. Do not exceed the default focus length."

## Testing Decisions

Areas with prior unit-test coverage that this change touches: `state.ts` (status.test, start.test), TUI (`tui-mutations-persist.test.tsx`). Match that style.

- **State module.** Add tests covering: (a) event-log writes happen for start/pause/resume/stop with the correct id and project, (b) expiry writes a completion with id but does *not* write a `stop` event, (c) late-binding — a record whose project is changed between start and expiry produces a completion with the *new* project, (d) legacy state.json without `id` is read without throwing.
- **TUI dot derivation.** Add a test that the dot row reflects today's completion count from a fixture `completions.jsonl`, including the case where dots fill across a focus→break→focus transition (the bug today).
- **Start command.** Add a test that `pmdr start` without `--project` and with no interactive picker writes a record with `project: "(unassigned)"` and emits a `start` event tagged with the new id.

Integration-test the event log against the file system (no mocks) — the file IS the contract.

## Out of Scope

- Backdating as a CLI feature (`--started-at` flag, fake-history rewrites, etc.). Lives only as guidance in the `pmdr-cli` skill.
- `project-changed` events. The completion row already carries the final project; intra-timer project switches aren't an interruption signal worth logging.
- Phase-transition events (focus→break, break→focus). Derivable from start events + durations.
- Event-sourcing the existing data — `state.json` and `completions.jsonl` remain authoritative for their respective concerns. The event log is a side channel.
- Session-based dot reset, manual dot reset, or any dot reset other than local midnight (which is implicit in "today's completions").
- A `pauseCount` field on completions. The agent can count pause events from `events.jsonl` if needed.
- Daemonised event aggregation, replication, or remote sync.

## Open Questions

None outstanding. Ready to slice.
