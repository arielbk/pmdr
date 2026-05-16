import React from "react";
import { Box, Text, useApp, useInput } from "ink";

export default function App() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q" || key.ctrl && input === "c") {
      exit();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        <Text dimColor>PMDR — Interactive TUI</Text>
      </Box>
      <Box justifyContent="center">
        <Text dimColor>space pause · s skip · p project · q quit · ? help</Text>
      </Box>
    </Box>
  );
}
