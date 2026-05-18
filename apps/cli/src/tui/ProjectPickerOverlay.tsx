import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectRecord } from "../projects.js";

interface ProjectPickerOverlayProps {
  projects: ProjectRecord[];
  onSelect: (name: string) => void;
  onClose: () => void;
}

export default function ProjectPickerOverlay({
  projects,
  onSelect,
  onClose,
}: ProjectPickerOverlayProps) {
  const entries = [...projects.map((p) => p.name), "new…"];
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");

  useInput((input, key) => {
    if (creatingNew) {
      if (key.return) {
        if (newName.trim()) {
          onSelect(newName.trim());
        }
      } else if (key.escape || input === "\x1B") {
        setCreatingNew(false);
        setNewName("");
      } else if (key.backspace || key.delete) {
        setNewName((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setNewName((prev) => prev + input);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIdx((i) => Math.min(entries.length - 1, i + 1));
    } else if (key.return) {
      const selected = entries[selectedIdx];
      if (selected === "new…") {
        setCreatingNew(true);
      } else if (selected !== undefined) {
        onSelect(selected);
      }
    } else if (key.escape || input === "\x1B") {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      paddingX={2}
      paddingY={1}
    >
      <Text bold>Switch project</Text>
      <Text dimColor>Applies from next block</Text>

      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, idx) => (
          <Box key={entry}>
            <Text color={idx === selectedIdx ? "cyan" : undefined}>
              {idx === selectedIdx ? "> " : "  "}
              {entry}
            </Text>
          </Box>
        ))}
      </Box>

      {creatingNew && (
        <Box marginTop={1}>
          <Text bold>New project: </Text>
          <Text>{newName}</Text>
          <Text dimColor>_</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {creatingNew
            ? "enter confirm · esc back"
            : "↑↓ navigate · enter select · esc close"}
        </Text>
      </Box>
    </Box>
  );
}
