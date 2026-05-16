import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    description: "Show current timer status",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run() {
    console.log("status: not yet implemented");
  },
});
