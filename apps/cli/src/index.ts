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

    const { render } = await import("ink");
    const { default: App } = await import("./tui/App.js");
    const React = await import("react");
    const { waitUntilExit } = render(React.default.createElement(App));
    await waitUntilExit();
  },
});

runMain(main);
