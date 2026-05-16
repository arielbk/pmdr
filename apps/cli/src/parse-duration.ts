export function parseDuration(s: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(s);
  if (!match) {
    throw new Error(
      `Invalid duration "${s}". Expected formats: 25m, 90s, 1h, 500ms`,
    );
  }
  const value = parseFloat(match[1]!);
  switch (match[2]) {
    case "ms":
      return Math.round(value);
    case "s":
      return Math.round(value * 1_000);
    case "m":
      return Math.round(value * 60_000);
    case "h":
      return Math.round(value * 3_600_000);
  }
  throw new Error("unreachable");
}
