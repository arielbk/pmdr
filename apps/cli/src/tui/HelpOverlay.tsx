import React from "react";
import { Box, Text, useInput } from "ink";

interface HelpOverlayProps {
  onClose: () => void;
  phase?: "focus" | "break";
}

const FOCUS_BINDINGS: Array<[string, string]> = [
  ["space", "pause / resume"],
  ["p", "switch project"],
  ["x", "stop session"],
  ["q / esc / ctrl+c", "quit / detach (timer keeps running)"],
  ["?", "toggle this help"],
];

const BREAK_BINDINGS: Array<[string, string]> = [
  ["space", "stop / skip break"],
  ["p", "switch project"],
  ["x", "stop session"],
  ["q / esc / ctrl+c", "quit / detach (timer keeps running)"],
  ["?", "toggle this help"],
];

export default function HelpOverlay({ onClose, phase = "focus" }: HelpOverlayProps) {
  useInput((input, key) => {
    if (key.escape || input === "\x1B" || input === "?") {
      onClose();
    }
  });

  const bindings = phase === "break" ? BREAK_BINDINGS : FOCUS_BINDINGS;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text bold>Keybindings</Text>
      <Box flexDirection="column" marginTop={1}>
        {bindings.map(([key, desc]) => (
          <Box key={key}>
            <Text>{"  "}</Text>
            <Box width={20}>
              <Text color="cyan" bold>
                {key}
              </Text>
            </Box>
            <Text dimColor>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color="cyan" bold>?</Text>
          <Text dimColor> or </Text>
          <Text color="cyan" bold>esc</Text>
          <Text dimColor> to close</Text>
        </Text>
      </Box>
    </Box>
  );
}
