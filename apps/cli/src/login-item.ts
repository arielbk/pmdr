import { APP_BUNDLE_ID, appBinaryPath, loginItemPlistPath } from "./app-probes.js";
import type { InstalledApp } from "./app-status.js";
import type { MenubarAppSystem } from "./menubar-app-system.js";

/**
 * A LaunchAgent that runs the installed app binary directly at login. We invoke
 * the executable rather than `open -a` so launchd owns the process and the plist
 * stays the single source of truth for the enabled state.
 */
export function loginItemPlist(binaryPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${APP_BUNDLE_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export interface AppLoginRunDeps {
  home: string;
  action: "enable" | "disable";
  probes: { probeInstalled(): InstalledApp };
  system: MenubarAppSystem;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppLogin(deps: AppLoginRunDeps): number {
  const plistPath = loginItemPlistPath(deps.home);

  if (deps.action === "disable") {
    // Disabling must work even with the app already gone — otherwise an
    // uninstall could strand an agent nobody can turn off.
    try {
      deps.system.removePath(plistPath);
    } catch (error) {
      deps.stderr(`pmdr app login: ${messageOf(error)}`);
      return 1;
    }
    deps.stdout("Launch at login: disabled");
    return 0;
  }

  const installed = deps.probes.probeInstalled();

  // The agent has to name a real binary, so there is nothing honest to write
  // before the app exists on disk.
  if (!installed.present) {
    deps.stderr(
      "pmdr app login: the menubar app is not installed — run `pmdr app install` first",
    );
    return 1;
  }

  try {
    deps.system.writeLoginItem(
      plistPath,
      loginItemPlist(appBinaryPath(installed.appPath)),
    );
  } catch (error) {
    deps.stderr(`pmdr app login: ${messageOf(error)}`);
    return 1;
  }

  deps.stdout("Launch at login: enabled");
  return 0;
}

export const LOGIN_ACTION_REQUIRED_MESSAGE =
  "pmdr app login: pass exactly one of --enable or --disable";

/** Neither flag and both flags are the same mistake: an ambiguous intent. */
export function loginActionFromArgs(args: {
  enable?: boolean;
  disable?: boolean;
}): { action: "enable" | "disable" } | { error: string } {
  if (args.enable === true && args.disable !== true) return { action: "enable" };
  if (args.disable === true && args.enable !== true) return { action: "disable" };
  return { error: LOGIN_ACTION_REQUIRED_MESSAGE };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
