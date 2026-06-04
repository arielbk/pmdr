import { defineCommand } from "citty";
import { createConfigModule, type PmdrConfig } from "../config.js";

type ConfigModule = ReturnType<typeof createConfigModule>;
type ConfigReader = Pick<ConfigModule, "readEffectiveConfig"> &
  Partial<Pick<ConfigModule, "setConfigValue">>;

export function runConfigCommand(options: {
  args: {
    json?: boolean;
    command?: string;
    key?: string;
    value?: string;
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

  if (options.args.command === "set") {
    if (!options.args.key || options.args.value === undefined) {
      throw new Error("Usage: pmdr config set <key> <value>");
    }
    if (!config.setConfigValue) {
      throw new Error("Config writer is unavailable");
    }
    config.setConfigValue(options.args.key, options.args.value);
    stdout(`${options.args.key}=${options.args.value}\n`);
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
      description: "Subcommand: get or set",
    },
    key: {
      type: "positional",
      required: false,
      description: "Config key for get",
    },
    value: {
      type: "positional",
      required: false,
      description: "Config value for set",
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
          value: args.value as string | undefined,
        },
      });
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  },
});
