# Backdating ("I started N minutes ago")

When the user says they started a pomodoro **N minutes ago** but never ran `pmdr start`, you can land the completion at the correct wall-clock time by shortening the duration:

```sh
pmdr start --project "<name>" --duration $((25 - N))m --no-interactive
```

Formula: `--duration = default_focus_minutes − N`. The default focus length is **25 minutes**, so:

- "I started 5 minutes ago" → `--duration 20m`
- "I started 10 minutes ago" → `--duration 15m`

## Rules

- **Never exceed the default focus length** (do not pass `--duration 25m` or longer when backdating — that's a fresh timer, not a backdate).
- If `N ≥ 25`, the block has already conceptually ended. Don't backdate — log the time manually or treat the request as a fresh start.
- If `N` is missing or ambiguous, ask the user to confirm before starting.

This rule lives in the skill, not the CLI: the CLI does not know about backdating, it only knows the requested `--duration`.
