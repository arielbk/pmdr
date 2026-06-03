# LAN Status Page (`pmdr serve`)

A manually-started, read-only `pmdr serve` daemon that broadcasts the current
Pomodoro to the local network — a single full-screen page mirroring the macOS
overlay (status label + large live countdown + project), reachable at
`http://<machine-name>.local:<port>`. Reuses the CLI's existing state file and
`getStatus()` logic; the menubar app is untouched.

Runs as a Ralph loop — no blocking human checkpoints; styling and end-to-end
behaviour get a human review pass at the end.

## Slices

### `serve-status-endpoint` — `pmdr serve` + JSON status endpoint

**Status:** needs-review

**Outside-in:** `pmdr serve [--port <n>]` (default port e.g. 7777) starts a
long-running HTTP server bound to `0.0.0.0` and blocks until Ctrl-C. `GET
/api/status` returns the live `StatusResult` JSON, produced by calling the
existing `getStatus({ store, now })` against a state module bound to the
production state dir (`~/.local/state/pmdr/`).

**Feedback loop:** Integration test — boot the server on an ephemeral port with
a state module pointed at a temp dir; seed idle / running / paused `StateRecord`s
and assert `GET /api/status` returns the matching JSON shape (mirrors the
existing `status` command tests).

**Human checkpoint:** no

**Depends on:** none

### `status-page` — Full-screen status page

**Status:** done

**Outside-in:** `GET /` serves a single self-contained HTML document (inlined
CSS + JS, no build step, no external assets) that fetches `/api/status` once and
renders the overlay look: status label on top, large monospace countdown,
project name beneath. Shows "Available" when idle; paused state is visually
distinct. Light/dark via `prefers-color-scheme`.

**Feedback loop:** `agent-browser` — load `/` against a server seeded with a
running session and assert the label, countdown, and project render and reflect
the seeded state; reload against idle state and assert "Available" shows.
Styling fidelity vs. the macOS overlay is confirmed in the end-of-run human
review.

**Human checkpoint:** no

**Depends on:** serve-status-endpoint

### `live-updates` — Self-updating countdown

**Status:** done

**Outside-in:** The page keeps itself current with no reload: it ticks the
countdown down locally every second from `remainingMs`, and polls `/api/status`
on an interval (a few seconds) to pick up phase-change, pause/resume, project,
and idle transitions.

**Feedback loop:** `agent-browser` — load `/` during a running session and
observe the countdown decrement across successive polls; transition the
underlying state (e.g. pause, or let it expire to idle) and assert the page
reflects the new state without a manual reload.

**Human checkpoint:** no

**Depends on:** status-page

### `lan-reachability-and-docs` — LAN reachability + README

**Status:** needs-review

**Outside-in:** The page is reachable from another device on the LAN at
`http://<machine-name>.local:<port>`, and `pmdr serve` is documented in the
README's "Running the CLI" section.

**Feedback loop:** Manual — open the `<machine-name>.local:<port>` URL from a
second device on the same network and confirm it loads and updates; README diff
shows the new command documented.

**Human checkpoint:** no

**Depends on:** live-updates
