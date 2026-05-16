import React from "react";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import type { DerivedPhaseState } from "./phase-state-machine.js";

interface CountdownViewProps extends DerivedPhaseState {
  project?: string;
}

function formatTime(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function blockDots(completed: number): string {
  if (completed === 0) return "○";
  return Array.from({ length: completed }, () => "●").join(" ");
}

export default function CountdownView({
  phase,
  remainingMs,
  completedFocusBlocks,
  paused,
  project,
}: CountdownViewProps) {
  const timeStr = formatTime(remainingMs);
  const colors: string[] = paused ? ["gray"] : phase === "focus" ? ["red"] : ["green"];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box justifyContent="center">
        <Text bold>{phase === "focus" ? "FOCUS" : "BREAK"}</Text>
      </Box>

      <Box justifyContent="center">
        <Text dimColor>{project ?? ""}</Text>
      </Box>

      <Box justifyContent="center">
        <BigText text={timeStr} colors={colors} />
      </Box>

      <Box justifyContent="center">
        <Text dimColor={paused}>{blockDots(completedFocusBlocks)}</Text>
      </Box>

      <Box justifyContent="center">
        <Text dimColor>
          {"space pause · s skip · p project · q quit · ? help"}
        </Text>
      </Box>
    </Box>
  );
}
