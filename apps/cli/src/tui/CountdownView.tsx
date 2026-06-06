import React from "react";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import type { DerivedPhaseState } from "./phase-state-machine.js";
import { DEFAULT_FOCUS_GOAL } from "../state.js";

interface CountdownViewProps extends DerivedPhaseState {
  project?: string;
  dailyGoal?: number;
  longBreakEvery?: number;
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

function buildDotRow(
  completedFocusBlocks: number,
  goal: number,
  longBreakEvery: number,
  paused: boolean,
): React.ReactNode {
  const filled = Math.min(completedFocusBlocks, goal);
  const segments: React.ReactNode[] = [];

  for (let i = 0; i < goal; i++) {
    const isFilled = i < filled;
    const dot = isFilled ? "●" : "○";
    const isGroupBoundary = longBreakEvery > 0 && i > 0 && i % longBreakEvery === 0;
    const sep = isGroupBoundary ? "  " : i > 0 ? " " : "";
    if (sep) {
      segments.push(<React.Fragment key={`sep-${i}`}>{sep}</React.Fragment>);
    }
    if (isFilled) {
      segments.push(
        <Text key={i} color="green" dimColor={paused}>
          {dot}
        </Text>,
      );
    } else {
      segments.push(
        <Text key={i} dimColor>
          {dot}
        </Text>,
      );
    }
  }

  return <>{segments}</>;
}

export default function CountdownView({
  phase,
  remainingMs,
  completedFocusBlocks,
  paused,
  project,
  dailyGoal = DEFAULT_FOCUS_GOAL,
  longBreakEvery = 4,
}: CountdownViewProps) {
  const timeStr = formatTime(remainingMs);
  const colors: string[] = paused ? ["gray"] : phase === "focus" ? ["red"] : ["green"];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box justifyContent="center">
        <Text bold>{phase === "focus" ? "FOCUS" : "BREAK"}</Text>
      </Box>

      <Box justifyContent="center">
        <Text dimColor>{project && project !== "(unassigned)" ? project : ""}</Text>
      </Box>

      <Box justifyContent="center">
        <BigText text={timeStr} colors={colors} />
      </Box>

      <Box justifyContent="center" marginTop={-1} marginBottom={1}>
        <Text>
          {buildDotRow(completedFocusBlocks, dailyGoal, longBreakEvery, paused)}
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
