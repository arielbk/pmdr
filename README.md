# pmdr

<p align="center">
  <img src="design/brand/pmdr-tomato.svg" width="144" alt="pmdr tomato mark">
</p>

A pomodoro timer with shared session state, surfaced through a CLI and a native macOS menubar app. One running session, many ways to drive it: start it in one terminal, check status from another, pause it with a global hotkey from the menubar, assign sessions to projects, and let agents (or scripts) read whether you're currently in deep focus.

The CLI owns the session state. The menubar app is a thin native shell over the CLI — it polls `pmdr status --json` and shells out to `pmdr` for control. Anything else that wants to read or drive a session can do the same.

## Repo layout

```
apps/
  cli/        # `pmdr` binary — Node/TypeScript, citty + Ink TUI. Owns session state.
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
pnpm release:pmdr -- --dry-run --version X.Y.Z   # verify the tarball
pnpm release:pmdr -- --version X.Y.Z             # stamp, build, publish to npm
```

The flow lives in `apps/cli/src/release.ts`; it stamps `apps/cli/package.json`, builds, `npm pack`s to `dist/releases/`, and publishes. Tagging and the GitHub release are manual.

## Running the CLI

```sh
pmdr                # opens the interactive TUI
pmdr start          # start a focus session
pmdr status         # current session, human-readable
pmdr status --json  # current session, for scripts / the menubar / agents
pmdr pause
pmdr resume
pmdr stop
pmdr today          # today's sessions
pmdr project ...    # assign sessions to projects
pmdr serve          # serve the read-only status page on the LAN
```

Open as many terminals as you want — they all read and write the same session.

`pmdr serve` starts a long-running HTTP server on port `7777` by default. Use
`pmdr serve --port <port>` to choose another port, then open
`http://<machine-name>.local:<port>` from another device on the same local
network to view the live status page.

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

`pmdr app install` is non-interactive and idempotent: reinstalling the version you already have is a no-op unless you pass `--force`. It quits a running app before replacing it, stages the extract next to the target inside `~/Applications`, then swaps it in — so a failed extract never leaves you without a working app. Everything is per-user, so no `sudo` is ever needed. These commands are macOS only and exit non-zero elsewhere.

## Running the menubar app

```sh
pnpm menubar           # build Debug and launch pmdr.app
pnpm menubar:gen       # regenerate pmdr-menubar.xcodeproj (run after editing project.yml)
```

`pnpm menubar` calls [`scripts/menubar-run.sh`](scripts/menubar-run.sh): it generates the Xcode project on first run, builds the Debug scheme, kills any running `pmdr` menubar instance, then launches the freshly built `.app`. The app appears only in the menubar (no Dock icon). It needs the `pmdr` CLI on your PATH — `pnpm setup` handles that.

**First-time setup gotcha:** if `xcodebuild` fails to load `IDESimulatorFoundation` or another plug-in (common right after an Xcode update), run `xcodebuild -runFirstLaunch` to install missing components, then retry.

See [`apps/menubar/README.md`](apps/menubar/README.md) for build/test details and the global hotkey.
