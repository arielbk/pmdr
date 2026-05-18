# pmdr

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

## Requirements

- Node 18+
- pnpm 9
- (Menubar only) macOS 13+, Xcode 15+, and [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`

## Quickstart

```sh
pnpm setup        # install, build, and link `pmdr` onto your PATH
```

Day-to-day:

```sh
pnpm dev          # watch mode across the JS workspace
pnpm build        # rebuild the CLI
```

## Running the CLI

`pnpm setup` links the `pmdr` binary globally. Then:

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
```

Open as many terminals as you want — they all read and write the same session.

## Running the menubar app

```sh
pnpm menubar      # regenerates the Xcode project and opens it
```

Hit Run in Xcode. The app appears only in the menubar (no Dock icon). It needs the `pmdr` CLI on your PATH — `pnpm setup` handles that.

See [`apps/menubar/README.md`](apps/menubar/README.md) for build/test details and the global hotkey.
