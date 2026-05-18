import React from "react";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import type { DerivedPhaseState } from "./phase-state-machine.js";
import { DEFAULT_FOCUS_GOAL } from "../state.js";

interface CountdownViewProps extends DerivedPhaseState {
  project?: string;
}

function formatTime(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

const HINTS: Array<[string, string]> = [
  ["space", "pause"],
  ["p", "project"],
  ["x", "stop"],
  ["q", "detach"],
  ["?", "help"],
];

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
        <Text>
          <Text color="green" dimColor={paused}>
            {Array.from({ length: Math.min(completedFocusBlocks, DEFAULT_FOCUS_GOAL) }, () => "●").join(" ")}
          </Text>
          {completedFocusBlocks > 0 && completedFocusBlocks < DEFAULT_FOCUS_GOAL ? " " : ""}
          <Text dimColor>
            {Array.from({ length: Math.max(0, DEFAULT_FOCUS_GOAL - completedFocusBlocks) }, () => "○").join(" ")}
          </Text>
          <Text dimColor>{`  ${Math.min(completedFocusBlocks, DEFAULT_FOCUS_GOAL)}/${DEFAULT_FOCUS_GOAL}`}</Text>
        </Text>
      </Box>

      <Box justifyContent="center">
        <Text>
          {HINTS.map(([key, desc], i) => (
            <React.Fragment key={key}>
              {i > 0 ? <Text dimColor>{"  ·  "}</Text> : null}
              <Text color="cyan" bold>{key}</Text>
              <Text dimColor>{` ${desc}`}</Text>
            </React.Fragment>
          ))}
        </Text>
      </Box>
    </Box>
  );
}
