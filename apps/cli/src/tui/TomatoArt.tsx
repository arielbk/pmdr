import React from "react";
import { Box, Text } from "ink";

interface TomatoArtProps {
  paused: boolean;
}

type BrandColor = "leaf" | "tomato";

interface ArtSegment {
  color?: BrandColor;
  text: string;
}

const COLORS: Record<BrandColor, string> = {
  leaf: "#3f7f4c",
  tomato: "#ed4d43",
};

// A terminal-scale translation of the menu-bar mark: oversized calyx, short
// ribs, a wide fruit, and the three bottom lobes that keep it from reading as
// an apple. It intentionally stays small beside the timer's large numerals.
const ROWS: ArtSegment[][] = [
  [{ text: "      " }, { color: "leaf", text: "\\ | /" }],
  [
    { color: "tomato", text: "    .--" },
    { color: "leaf", text: "\\|/" },
    { color: "tomato", text: "--." },
  ],
  [{ color: "tomato", text: "   /  \\   /  \\" }],
  [{ color: "tomato", text: "  |           |" }],
  [{ color: "tomato", text: "   \\__/\\_/\\__/" }],
];

export default function TomatoArt({ paused }: TomatoArtProps) {
  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      {ROWS.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {row.map((segment, segmentIndex) => (
            <Text
              key={segmentIndex}
              color={
                paused
                  ? "gray"
                  : segment.color
                    ? COLORS[segment.color]
                    : undefined
              }
              dimColor={paused}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
