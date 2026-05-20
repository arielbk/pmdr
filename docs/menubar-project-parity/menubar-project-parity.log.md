# Menubar Project Parity — Implementation Log

## `cli-start-no-project` — 2026-05-20 11:18:06

**Status:** done
**Summary:** Removed the non-TTY error gate in `pmdr start`. A missing `--project` now resolves to `(unassigned)` in any mode. The dead `--no-interactive` flag was removed alongside the gate (had no remaining consumer). Added a regression test exercising `resolveStartProject(undefined) + initTimer` to assert state writes `(unassigned)` without touching `projects.json`.
**Deviations:** Slice spec mentioned only removing the error; I also deleted the now-dead `--no-interactive` flag declaration on the citty command since nothing else referenced it.
**Handoff:** `start.ts`'s `run` no longer reads `process.stdout.isTTY`. Downstream `cli-project-set` will add a `pmdr project set` subcommand for later reassignment — which is the mechanism users rely on after starting unassigned. Verified: 261 cli tests pass, tsc clean.

## `cli-project-set` — 2026-05-20 11:20:15

**Status:** done
**Summary:** Added `pmdr project set` subcommand and `setProjectLogic` in `commands/project.ts`. Reassigns the running or paused session's project, auto-creates on unknown names, and clears to `(unassigned)` with `--none`. Errors on: no session, mutually exclusive args, neither arg, and reserved-sentinel name (case-insensitive). New `project-set.test.ts` covers all cases via the logic helper. State writes use `{...file, project: newName}` so all other fields (startedAt, pausedAt, id, phase, completedFocusBlocks) are preserved.
**Deviations:** `--none` writes `project: "(unassigned)"` explicitly (matches the menubar slice's expected `pmdr status --json` output). The TUI's None path drops the field entirely and relies on finalize's `?? "(unassigned)"` fallback — both forms yield the same finalized completion, but the explicit form is what the downstream menubar slice asserts against.
**Handoff:** No event-log emission was added for project changes — slice spec didn't ask for one and event types (`start|stop|pause|resume`) don't model reassignment. If the menubar wants the change visible in `pmdr today` analytics, that's a follow-up. Verified: 271 cli tests pass, tsc clean.

## `menubar-start-none` — 2026-05-20 11:22:05

**Status:** needs-review
**Summary:** Added "None" entry to the idle-state Start submenu in `AppDelegate.rebuildMenu()`, placed below the project list (after the separator) and above "New project...". Wired `@objc startNoneFromMenu` to call `client.start(project: nil)`. Made the `project:` parameter on `PmdrClient.start` optional and default to nil; when nil, the args become `start --force --detach` with no `--project` flag (enabled by slice 1's removal of the non-TTY gate).
**Deviations:** none.
**Handoff:** Requires manual verification (see slice feedback loop). Xcode build succeeded via `xcodebuild -scheme pmdr-menubar -configuration Debug build CODE_SIGNING_ALLOWED=NO`. After approval: downstream `menubar-change-project` will add the mid-session reassignment UI and depends on `cli-project-set`.

## `menubar-change-project` — 2026-05-20 (live build)

**Status:** needs-review
**Summary:** Added `PmdrClient.setProject(_:)` shelling out to `pmdr project set <name>` or `pmdr project set --none`. Replaced the disabled `Project: X` label in the running/paused menu with a "Change project ▸" item. Extracted a shared `projectPickerSubmenu(current:projectAction:noneAction:newProjectAction:)` used by both surfaces (idle Start + running Change). Picker now renders a checkmark (`.state = .on`) on the matching project (or on "None" when `current` is nil). Refactored the "New project..." alert into a shared `promptForNewProjectName(confirmTitle:)` helper so the same dialog routes through `start(project:)` from idle or `setProject(_:)` from mid-session.
**Deviations:** Idle Start submenu now also filters archived projects — the original code listed all projects unfiltered; the PRD spec called for "non-archived" in the shared picker, and applying it consistently fixes the prior inconsistency. Confirm button label in the New-project alert is now context-sensitive ("Start" from idle, "Switch" from mid-session) — small affordance, no spec change.
**Handoff:** Manual verification per slice feedback loop. Also bundled: `package.json` `menubar` script changed to build + launch the `.app` directly (no Xcode). README updated to match.
