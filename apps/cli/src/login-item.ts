import { APP_BUNDLE_ID } from "./app-probes.js";

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

export const LOGIN_ACTION_REQUIRED_MESSAGE =
  "pmdr app login: pass exactly one of --enable or --disable";

/** Neither flag and both flags are the same mistake: an ambiguous intent. */
export function loginActionFromArgs(args: {
  enable?: boolean;
  disable?: boolean;
}): { enabled: boolean } | { error: string } {
  if (args.enable === true && args.disable !== true) return { enabled: true };
  if (args.disable === true && args.enable !== true) return { enabled: false };
  return { error: LOGIN_ACTION_REQUIRED_MESSAGE };
}
