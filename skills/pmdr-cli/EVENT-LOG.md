# Event log — reading interruption signals

Read this when you need to characterise the texture of a working day (interruptions, abandoned blocks, mid-timer reassignments), not just count finished pomodoros. For "how many pomodoros today?" stick with `pmdr today --json`.

## Where it lives

`~/.local/state/pmdr/events.jsonl` — append-only JSONL, no CLI read command. Read the file directly.

## Row shape

```jsonc
{ "type": "start" | "pause" | "resume" | "stop",
  "at": 1700000000000,
  "id": "uuid…",
  "project": "Work" }
```

## Joining events to completions

Every timer gets a uuid at `start`. That `id` is on:
- the active timer record (`state.json`)
- every event row for that timer (`events.jsonl`)
- the completion row, if it finishes (`completions.jsonl`)

Join on `id` to reconstruct a single timer's lifecycle.

## Event semantics

- `start` — `pmdr start` wrote a new record. Project on the event = project at start time (may be `(unassigned)`; can be reassigned later via the TUI's `p` command).
- `pause` / `resume` — explicit user pause/resume during a running timer.
- `stop` — `pmdr stop` was called before expiry (abandoned timer). **No completion row will exist for this id.**
- **No `stop` event on normal expiry.** For finished timers the completion row is the record. So: `start` + matching completion = finished; `start` + `stop` and no completion = abandoned.

## Signals worth surfacing in a daily review

- Count of `stop` events → abandoned/interrupted blocks.
- Count of `pause`/`resume` pairs per finished timer → blocks where the user kept stepping away.
- Gap between `start` and first `pause` → how deep the user got before the first interruption.
- Timers whose final project (from the completion row) differs from the project on their `start` event → late-binding / mid-timer reassignment.

## Attribution rule

The `project` on a `start` event is captured at start time. The *true* attribution for a finished block lives on the completion row (project is mutable mid-timer). **Trust the completion for "what did I work on"; trust events for "what happened."**
