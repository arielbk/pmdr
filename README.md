# pmdr

<p align="center">
  <img src="design/brand/pmdr-tomato.svg" width="144" alt="pmdr tomato mark">
</p>

A pomodoro timer with shared session state, surfaced through a CLI and a native macOS menubar app. One running session, many ways to drive it: start it in one terminal, check status from another, pause it with a global hotkey from the menubar, assign sessions to projects, and let agents (or scripts) read whether you're currently in deep focus.

The CLI owns the session state. The menubar app is a thin native shell over the CLI — it polls `pmdr status --json` and shells out to `pmdr` for control. Anything else that wants to read or drive a session can do the same.

## Repo layout

```
apps/
  cli/        # `pmdr` binary — Node/TypeScript, citty. Owns session state.
  menubar/    # Native macOS menubar app (Swift / Xcode). Thin client over the CLI.
packages/
  ui/                # Shared React component stubs
  eslint-config/     # Shared ESLint config
  typescript-config/ # Shared tsconfig presets
```

`apps/menubar` lives outside the Turbo pipeline — it has its own Xcode toolchain. Everything else is wired through Turborepo + pnpm.

`docs/` holds per-feature specs, task breakdowns, implementation logs, and QA notes. It is **local-only and not tracked in Git** (see `.gitignore`) — these are working implementation details, not part of the shipped repo history.

## Install

The CLI is published to npm as [`@arielbk/pmdr`](https://www.npmjs.com/package/@arielbk/pmdr):

```sh
npm install -g @arielbk/pmdr
```

## Requirements

- Node 18+ (install only); development also needs pnpm 9
- (Menubar only) macOS 13+, Xcode 15+, and [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`

## Developing

```sh
pnpm setup        # install, build, and link the local `pmdr` build onto your PATH
pnpm dev          # watch mode across the JS workspace
pnpm build        # rebuild the CLI
```

`pnpm setup` links the working-tree build globally (replacing any npm-installed `pmdr` on your PATH) so you can dogfood changes.

### Releasing

```sh
gh run download --name pmdr-app --dir apps/cli/bundled-app   # take the CI-built menubar app
pnpm release:pmdr -- --dry-run --version X.Y.Z               # verify the tarball
pnpm release:pmdr -- --version X.Y.Z                         # stamp, build, publish to npm
```

The flow lives in `apps/cli/src/release.ts`; it stamps `apps/cli/package.json`, builds, `npm pack`s to `dist/releases/`, and publishes. Tagging and the GitHub release are manual.

A published release must carry the menubar app: the release refuses to stamp or publish unless `apps/cli/bundled-app/pmdr-app.zip` and its version sidecar are in place, and after packing it checks that the tarball really contains them. Get the zip either from CI (the command above, or `--app-artifact <downloaded-dir>` to let the release stage it for you) or locally with `pnpm menubar:zip`. `--allow-missing-app` publishes a CLI-only release on purpose.

It must also carry the *current* app: the release refuses a zip whose version disagrees with `MARKETING_VERSION` in `apps/menubar/project.yml`. Shipping a zip built from older sources is worse than shipping none — `pmdr app install` only moves you to a newer version than the one installed, so a stale zip pins every user to the old app and leaves `pmdr app status` calling it up to date. `--allow-missing-app` does not waive this; it permits shipping no app, not the wrong one.

`.github/workflows/menubar-app.yml` is where the app binary comes from: a macOS runner runs `xcodegen`, builds Release, checks the zip with `scripts/verify-menubar-zip.sh` (signature valid, every Mach-O universal), uploads it as the `pmdr-app` artifact, and then runs the JS tests, lint and typecheck with the zip present so the install integration test actually runs.

## Running the CLI

```sh
pmdr                # setup, attach, or start — see below
pmdr setup          # install the menubar app
pmdr start          # start a focus session
pmdr status         # current session, human-readable
pmdr status --json  # current session, for scripts / the menubar / agents
pmdr pause
pmdr resume
pmdr stop
pmdr today          # today's sessions
pmdr project ...    # assign sessions to projects
pmdr config ...     # durations, daily goal, sounds
pmdr serve          # serve the read-only status page on the LAN
```

Open as many terminals as you want — they all read and write the same session.

Bare `pmdr` is a router over the three things it could reasonably mean, in this
order:

| Situation                              | What `pmdr` does                         |
| -------------------------------------- | ---------------------------------------- |
| Nothing set up yet, on a terminal      | Runs `pmdr setup`                        |
| A session is already running or paused | Attaches to it and renders the countdown |
| Anything else                          | Starts a pomodoro, like `pmdr start`     |

"Set up" means any of a completed `pmdr setup`, a `config.json`, a project, or a
session you have run before — so an upgrade never drops an existing install back
into onboarding.

`pmdr setup` has one job: getting the menubar app installed, and launching it at
login. Nothing else is worth a question — every setting already has a good
default and a one-liner (`pmdr config set …`, `pmdr project add …`) for changing
it, so onboarding stays one screen rather than something people quit halfway
through.

It is also the only command that needs an interactive terminal: without one it
exits `1` with a single line naming the commands (`pmdr app install`, `pmdr app
login --enable`) that do the same work non-interactively. Bare `pmdr` never
onboards without a TTY — it goes straight to the timer, because a prompt would
hang the script that ran it.

Every command is safe to script. Where stdout is not a TTY, `pmdr` and `pmdr
start` still start the session but skip the repainting countdown — they print one
line pointing at `pmdr status --json` and exit, rather than holding the pipe open
for the whole pomodoro. `pmdr start --detach` does the same thing silently.

`pmdr serve` starts a long-running HTTP server on port `7777` by default. Use
`pmdr serve --port <port>` to choose another port, then open
`http://<machine-name>.local:<port>` from another device on the same local
network to view the live status page.

## Integrations

`pmdr status --json` is the whole integration surface. There is no daemon, no
socket, and no event system — a status bar, prompt, or widget polls the command
(or watches the state file) and renders from the payload. Everything an
integration needs to draw a drift-free countdown is in it.

### tmux

`pmdr status` already prints a status-bar-ready one-liner, so the whole
integration is one line in `.tmux.conf`:

```tmux
set -g status-right '#(pmdr status)'
set -g status-interval 5
```

`status-interval` is how often tmux re-runs the command, in seconds; 5 keeps the
countdown within a second or so of true and keeps expired phases advancing
promptly. Going to 1 costs you a process per second for no visible gain — tmux
redraws on its own schedule either way, so the display is never smoother than
`status-interval`. When the timer is idle the command prints `idle`; use the
`--json` form below if you would rather show nothing.

For your own format, go through `--json` and `jq`. Quoting this inline in
`.tmux.conf` is miserable, so put it in a script — `~/.config/tmux/pmdr.sh`:

```sh
#!/bin/sh
pmdr status --json | jq -r '
  if .state == "idle" then ""
  else
    (.remainingMs / 1000 | floor) as $s
    | "\(if .phase == "focus" then "🍅" else "☕" end) "
      + "\($s / 60 | floor):\("00" + ($s % 60 | tostring) | .[-2:])"
      + (if .state == "paused" then " ⏸" else "" end)
  end'
```

```tmux
set -g status-right '#(~/.config/tmux/pmdr.sh)'
```

Note the branch on `.state` — idle has no `phase` or `remainingMs` to read, and
`endsAt` is `null` while paused. Rendering from `remainingMs` is correct here
because tmux re-runs the command every `status-interval` seconds rather than
ticking a clock of its own; a consumer that does tick should use `endsAt` and
the render rule below.

### The payload

Running or paused:

```json
{
  "state": "running",
  "remainingMs": 1289413,
  "endsAt": 1754750041000,
  "duration": 1500000,
  "startedAt": 1754748541000,
  "phase": "focus",
  "completedFocusBlocks": 0,
  "todayFocusBlocks": 2,
  "longBreakEvery": 4,
  "project": "pmdr"
}
```

| Field                  | Meaning                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `state`                | `"running"`, `"paused"`, or `"idle"`                                   |
| `remainingMs`          | Milliseconds left in this phase. Authoritative and frozen while paused |
| `endsAt`               | Epoch ms when this phase ends — `null` while paused                    |
| `duration`             | Nominal length of this phase in ms                                     |
| `startedAt`            | Epoch ms the phase started                                             |
| `phase`                | `"focus"` or `"break"`                                                 |
| `completedFocusBlocks` | Focus blocks completed in the current long-break cycle                 |
| `todayFocusBlocks`     | Focus blocks completed today                                           |
| `longBreakEvery`       | Focus blocks per long break                                            |
| `project`              | Assigned project, omitted when there is none                           |

When no session is running the payload is exactly:

```json
{ "state": "idle" }
```

No other keys — not even `endsAt`. Branch on `state` before reading anything
else.

`endsAt` is not something you can compute yourself. `startedAt + duration` is
wrong for any session that has been paused, because the pause time pushes the
end out; `endsAt` accounts for it.

### Rendering

```
running → display  endsAt - now
paused  → display  remainingMs   (frozen; endsAt is null)
idle    → display  nothing
```

That is the whole rule. Tick on your own clock against the absolute `endsAt`
and the displayed second can never drift, replay, or skip, however long ago you
last polled. Do not decrement `remainingMs` locally between polls — that is a
second clock, and the moment it disagrees with the payload the display jumps.
While paused, `remainingMs` is the frozen truth and there is nothing to tick.

If your consumer runs on a different machine than the CLI, its clock may be
skewed relative to pmdr's. Derive the offset from the payload once —
`(endsAt - remainingMs) - <the local time you received it>` — and render
against the corrected clock, which is both drift-free and skew-immune.

### When to poll

You only need a fresh payload when something you cannot predict has happened.
Two triggers cover everything:

1. **Local expiry.** You know the exact moment the phase ends — it is `endsAt`.
   Re-poll then to pick up the next phase. Between now and then, nothing about
   the countdown needs the CLI.
2. **`state.json` changed.** Every session lives in
   `~/.local/state/pmdr/state.json`. A start, pause, resume, stop, or project
   change rewrites it, and nothing else can change the timer.

A fixed low-frequency poll (say every 5 seconds, tmux's default
`status-interval` territory) is a fine stand-in for both, and it has a useful
side effect: pmdr advances an expired phase lazily, on read, so a polling
consumer also keeps focus→break transitions timely for everyone.

For near-instant reaction without a poll loop, watch the file — `fswatch` on
macOS, `inotifywait` on Linux — and run `pmdr status --json` on change:

```sh
fswatch -o ~/.local/state/pmdr/state.json | while read -r _; do
  pmdr status --json
done
```

That gets you push semantics with no daemon on either side.

### No daemon, deliberately

pmdr will not grow a background process, a socket, an event bus, or exec hooks
to serve integrations. The state file plus a command that reads it is enough:
`endsAt` makes the countdown predictable without a push channel, and watching
one file covers the transitions that aren't. A daemon would add a lifecycle to
supervise, a second source of truth to keep in sync, and a failure mode where
your status bar is stale because something crashed hours ago. This is settled —
integrations should build on the pull contract above rather than ask for a push
one.

## The bundled menubar app

The npm package ships the built menubar app, so a global CLI install carries both surfaces:

```sh
pmdr app status        # is the app installed, is it running, is it up to date
pmdr app status --json # same, machine-readable
pmdr app install       # extract the bundled app to ~/Applications and launch it
pmdr app install --force --no-launch
pmdr app login --enable   # launch the app automatically at login
pmdr app login --disable  # stop launching it at login
pmdr app uninstall     # remove the app and any launch-at-login item
```

`pmdr app login --enable` writes a `dev.pmdr.menubar` LaunchAgent to `~/Library/LaunchAgents` that runs the installed app binary with `RunAtLoad`; `--disable` removes it. That plist is the single source of truth for the setting — `pmdr app status --json` reports it as `loginItem`, and the menubar app's own toggle goes through this same command. Enabling requires the app to be installed; disabling works regardless, so an uninstall can never strand an agent you cannot turn off. It takes effect at your next login rather than immediately.

`pmdr setup` is this offer, made deliberately. For installs that predate it, the offer also stays where it always was: the first time you run plain `pmdr` in an interactive terminal with the app missing — or with an older one installed than the CLI ships — it offers to install and launch it for you. Decline once and it never asks again (the answer is remembered in `app-prompt.json` next to your config, which `pmdr setup` writes to as well, so declining in either place settles it); `pmdr app install` is always there if you change your mind. The offer is suppressed whenever stdout or stdin is not a TTY and for any `--json` invocation, so scripts and agents are never blocked by it.

`pmdr app install` is non-interactive and idempotent: reinstalling the version you already have is a no-op unless you pass `--force`. It quits a running app before replacing it, stages the extract next to the target inside `~/Applications`, then swaps it in — so a failed extract never leaves you without a working app. Everything is per-user, so no `sudo` is ever needed. These commands are macOS only and exit non-zero elsewhere.

## Running the menubar app

```sh
pnpm menubar           # build Debug and launch pmdr.app
pnpm menubar:gen       # regenerate pmdr-menubar.xcodeproj (run after editing project.yml)
```

`pnpm menubar` calls [`scripts/menubar-run.sh`](scripts/menubar-run.sh): it generates the Xcode project on first run, builds the Debug scheme, kills any running `pmdr` menubar instance, then launches the freshly built `.app`. The app appears only in the menubar (no Dock icon). It needs the `pmdr` CLI on your PATH — `pnpm setup` handles that.

**First-time setup gotcha:** if `xcodebuild` fails to load `IDESimulatorFoundation` or another plug-in (common right after an Xcode update), run `xcodebuild -runFirstLaunch` to install missing components, then retry.

See [`apps/menubar/README.md`](apps/menubar/README.md) for build/test details and the global hotkey.
