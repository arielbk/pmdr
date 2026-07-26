import { defineCommand, runMain } from "citty";
import startCmd from "./commands/start.js";
import pauseCmd from "./commands/pause.js";
import resumeCmd from "./commands/resume.js";
import stopCmd from "./commands/stop.js";
import statusCmd from "./commands/status.js";
import todayCmd from "./commands/today.js";
import projectCmd from "./commands/project.js";
import serveCmd from "./commands/serve.js";
import configCmd from "./commands/config.js";
import noteCmd from "./commands/note.js";
import appCmd from "./commands/app.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const subCommands = {
  start: startCmd,
  pause: pauseCmd,
  resume: resumeCmd,
  stop: stopCmd,
  status: statusCmd,
  today: todayCmd,
  project: projectCmd,
  serve: serveCmd,
  config: configCmd,
  note: noteCmd,
  app: appCmd,
};

function isSubCommandInvocation(rawArgs: string[]): boolean {
  for (const arg of rawArgs) {
    if (arg === "--") {
      return false;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return arg in subCommands;
  }
  return false;
}

const main = defineCommand({
  meta: {
    name: "pmdr",
    version: pkg.version,
    description: "Pomodoro timer for the terminal",
  },
  subCommands,
  async run({ rawArgs }) {
    if (isSubCommandInvocation(rawArgs)) {
      return;
    }

    // Only the plain-timer path reaches here. Refuse before Ink gets a chance
    // to throw its raw-mode error, so a scripted `pmdr` gets one actionable
    // line rather than a renderer stack trace.
    const { checkTuiPrecondition } = await import("./tui-precondition.js");
    const precondition = checkTuiPrecondition({
      stdinIsTty: process.stdin.isTTY === true,
      stdoutIsTty: process.stdout.isTTY === true,
    });
    if (!precondition.ok) {
      console.error(precondition.message);
      process.exitCode = 1;
      return;
    }

    // The offer gates itself on an interactive TTY too — so no agent or
    // `--json` caller can ever be blocked.
    const { maybeOfferBundledApp } = await import("./first-run-prompt.js");
    await maybeOfferBundledApp(rawArgs);

    const { render } = await import("ink");
    const { default: App } = await import("./tui/App.js");
    const React = await import("react");
    const { waitUntilExit } = render(React.default.createElement(App));
    await waitUntilExit();
  },
});

runMain(main);
