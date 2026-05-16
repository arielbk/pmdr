import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    description: "Start a 25-minute pomodoro timer",
  },
  args: {
    duration: {
      type: "string",
      description: "Custom duration (e.g. 25m, 10s)",
    },
  },
  run() {
    console.log("start: not yet implemented");
  },
});
