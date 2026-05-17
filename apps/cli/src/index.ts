import { defineCommand, runMain } from "citty";
import startCmd from "./commands/start.js";
import pauseCmd from "./commands/pause.js";
import resumeCmd from "./commands/resume.js";
import stopCmd from "./commands/stop.js";
import statusCmd from "./commands/status.js";
import todayCmd from "./commands/today.js";
import projectCmd from "./commands/project.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const main = defineCommand({
  meta: {
    name: "pmdr",
    version: pkg.version,
    description: "Pomodoro timer for the terminal",
  },
  subCommands: {
    start: startCmd,
    pause: pauseCmd,
    resume: resumeCmd,
    stop: stopCmd,
    status: statusCmd,
    today: todayCmd,
    project: projectCmd,
  },
});

runMain(main);
