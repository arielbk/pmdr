import type { DerivedKind } from "./state.js";

export interface BareRouteInputs {
  /** `isSetUp` over the evidence on disk. */
  setUp: boolean;
  /** Both stdin and stdout are a real terminal. */
  isTty: boolean;
  /** The session kind after expired phases have been advanced. */
  session: DerivedKind;
}

export type BareRoute = "setup" | "attach" | "start";

/**
 * What bare `pmdr` does. There is no interactive timer any more, so the bare
 * command is a router over the three things someone plausibly means by it:
 * onboard me, show me the session I already have, or start one.
 *
 * Setup wins on a fresh install, but only on a terminal — a scripted `pmdr`
 * cannot answer prompts, so it skips straight to the timer rather than hanging.
 * `attach` exists so that running `pmdr` while a session is live prints the
 * countdown instead of failing with "a pomodoro is already running".
 */
export function decideBareRoute(inputs: BareRouteInputs): BareRoute {
  if (!inputs.setUp && inputs.isTty) return "setup";
  if (inputs.session === "running" || inputs.session === "paused") {
    return "attach";
  }
  return "start";
}
