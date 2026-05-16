import React from "react";
import { Box, Text, useInput } from "ink";

interface HelpOverlayProps {
  onClose: () => void;
}

const BINDINGS = [
  { key: "space", desc: "pause / resume" },
  { key: "s", desc: "skip to next phase" },
  { key: "p", desc: "switch project" },
  { key: "q", desc: "quit" },
  { key: "?", desc: "toggle this help" },
] as const;

export default function HelpOverlay({ onClose }: HelpOverlayProps) {
  useInput((input, key) => {
    if (key.escape || input === "\x1B" || input === "?") {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text bold>Keybindings</Text>
      <Box flexDirection="column" marginTop={1}>
        {BINDINGS.map(({ key, desc }) => (
          <Text key={key}>
            {"  "}
            {key.padEnd(6)}
            {"  "}
            {desc}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>? or esc to close</Text>
      </Box>
    </Box>
  );
}
