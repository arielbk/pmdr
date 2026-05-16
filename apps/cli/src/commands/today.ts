import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    description: "Show today's completed pomodoros",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run() {
    console.log("today: not yet implemented");
  },
});
