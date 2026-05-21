import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectRecord } from "../projects.js";

type Entry =
  | { kind: "project"; name: string }
  | { kind: "none" }
  | { kind: "new" };

interface ProjectPickerOverlayProps {
  projects: ProjectRecord[];
  onSelect: (name: string | null) => void;
  onClose: () => void;
  onArchive?: (name: string) => void;
}

export default function ProjectPickerOverlay({
  projects,
  onSelect,
  onClose,
  onArchive,
}: ProjectPickerOverlayProps) {
  const entries: Entry[] = [
    { kind: "none" as const },
    ...projects.map((p) => ({ kind: "project" as const, name: p.name })),
    { kind: "new" as const },
  ];
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [newName, setNewName] = useState("");

  const onNewEntry = entries[selectedIdx]?.kind === "new";

  useInput((input, key) => {
    if (key.escape || input === "\x1B") {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
      setNewName("");
      return;
    }

    if (key.downArrow) {
      setSelectedIdx((i) => Math.min(entries.length - 1, i + 1));
      setNewName("");
      return;
    }

    if (key.return) {
      const selected = entries[selectedIdx];
      if (!selected) return;
      if (selected.kind === "new") {
        const name = newName.trim();
        if (name) onSelect(name);
      } else if (selected.kind === "none") {
        onSelect(null);
      } else {
        onSelect(selected.name);
      }
      return;
    }

    if (onNewEntry) {
      if (key.backspace || key.delete) {
        setNewName((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setNewName((prev) => prev + input);
      }
      return;
    }

    if (input === "a" && !key.ctrl && !key.meta) {
      const selected = entries[selectedIdx];
      if (selected?.kind === "project" && onArchive) {
        onArchive(selected.name);
      }
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
        {entries.map((entry, idx) => {
          const isSelected = idx === selectedIdx;
          const isSpecial = entry.kind !== "project";
          const baseLabel =
            entry.kind === "project"
              ? entry.name
              : entry.kind === "none"
                ? "None"
                : "New";
          const color = isSelected ? "cyan" : undefined;
          const key =
            entry.kind === "project" ? `p:${entry.name}` : entry.kind;
          const isNewInput = entry.kind === "new" && isSelected;
          return (
            <Box key={key}>
              <Text color={color} dimColor={isSpecial && !isSelected}>
                {isSelected ? "> " : "  "}
                {baseLabel}
                {isNewInput ? ": " : ""}
                {isNewInput ? newName : ""}
                {isNewInput ? "_" : ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {onNewEntry
            ? "type name · enter confirm · esc close"
            : "↑↓ navigate · enter select · esc close"}
        </Text>
      </Box>
    </Box>
  );
}
