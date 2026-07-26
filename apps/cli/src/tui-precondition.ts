/**
 * Whether the interactive timer can render at all.
 *
 * Ink needs raw-mode stdin and a real stdout to draw into. Without them its
 * `render` throws "Raw mode is not supported" and the unhandled failure spills
 * ~40 lines of Ink and react-reconciler frames — renderer internals in the face
 * of anyone who put a bare `pmdr` in a script. Deciding up front turns that into
 * one actionable line pointing at the machine-readable command instead.
 */
export interface TuiPreconditionInputs {
  stdinIsTty: boolean;
  stdoutIsTty: boolean;
}

export type TuiPrecondition = { ok: true } | { ok: false; message: string };

export function checkTuiPrecondition(
  inputs: TuiPreconditionInputs,
): TuiPrecondition {
  if (inputs.stdinIsTty && inputs.stdoutIsTty) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      "pmdr: the interactive timer needs an interactive terminal — use `pmdr status --json` to read the session, or `pmdr start --detach` to start one.",
  };
}
