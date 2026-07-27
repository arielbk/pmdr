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
import setupCmd from "./commands/setup.js";
import { cliVersion } from "./version.js";

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
  setup: setupCmd,
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
    version: cliVersion(),
    description: "Pomodoro timer for the terminal",
  },
  subCommands,
  async run({ rawArgs }) {
    if (isSubCommandInvocation(rawArgs)) {
      return;
    }

    // Bare `pmdr` is a router, not a surface of its own: onboard, attach to the
    // session that is already running, or start one. See `bare-command.ts`.
    const { runBareCommand } = await import("./bare-command.js");
    await runBareCommand();
  },
});

runMain(main);
