import { defineCommand } from "citty";
import { createConfigModule, type PmdrConfig } from "../config.js";

type ConfigReader = Pick<
  ReturnType<typeof createConfigModule>,
  "readEffectiveConfig"
>;

export function runConfigCommand(options: {
  args: {
    json?: boolean;
    command?: string;
    key?: string;
  };
  config?: ConfigReader;
  stdout?: (text: string) => void;
}): void {
  const config = options.config ?? createConfigModule();
  const stdout =
    options.stdout ?? ((text: string) => process.stdout.write(text));
  const effective = config.readEffectiveConfig();

  if (options.args.json) {
    stdout(`${JSON.stringify(effective, null, 2)}\n`);
    return;
  }

  if (options.args.command === "get") {
    const key = options.args.key as keyof PmdrConfig | undefined;
    if (!key || !(key in effective)) {
      throw new Error(`Unknown config key: ${options.args.key ?? ""}`);
    }
    stdout(`${effective[key]}\n`);
    return;
  }

  stdout(`${JSON.stringify(effective, null, 2)}\n`);
}

export default defineCommand({
  meta: {
    description: "Read pmdr configuration",
  },
  args: {
    command: {
      type: "positional",
      required: false,
      description: "Subcommand: get",
    },
    key: {
      type: "positional",
      required: false,
      description: "Config key for get",
    },
    json: {
      type: "boolean",
      description: "Print effective config as JSON",
      default: false,
    },
  },
  run({ args }) {
    try {
      runConfigCommand({
        args: {
          json: args.json as boolean,
          command: args.command as string | undefined,
          key: args.key as string | undefined,
        },
      });
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  },
});
