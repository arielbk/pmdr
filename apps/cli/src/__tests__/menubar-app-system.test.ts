import { describe, expect, it } from "vitest";
import { createMenubarAppSystem } from "../menubar-app-system.js";

const APP_PATH = "/Users/someone/Applications/pmdr.app";

/** An `execFileSync`-shaped failure: the useful part is on `stderr`. */
function openFailure(stderr: string): Error {
  return Object.assign(
    new Error("Command failed: /usr/bin/open -a /Users/someone/Applications/pmdr.app"),
    { stderr },
  );
}

describe("launchApp", () => {
  it("retries a launch that LaunchServices has not caught up with yet", () => {
    // -600 is procNotFound: the bundle is right there, the old registration is
    // just not gone yet. One attempt would report a false failure.
    let attempts = 0;
    const system = createMenubarAppSystem("/Users/someone", {
      sleep: () => {},
      open: () => {
        attempts += 1;
        if (attempts < 3) throw openFailure("failed ... with error -600.");
      },
    });

    expect(() => system.launchApp(APP_PATH)).not.toThrow();
    expect(attempts).toBe(3);
  });

  it("gives up eventually, reporting what open actually said", () => {
    const system = createMenubarAppSystem("/Users/someone", {
      sleep: () => {},
      open: () => {
        throw openFailure("Unable to find application named 'pmdr'");
      },
    });

    expect(() => system.launchApp(APP_PATH)).toThrow(
      /Command failed.*Unable to find application named 'pmdr'/s,
    );
  });
});

describe("quitApp", () => {
  it("waits for the app to actually be gone before returning", () => {
    // The quit only *asks*. Returning while the process is still alive is what
    // hands the swap a live bundle and the relaunch a -600.
    let alive = 3;
    const seen: number[] = [];
    const system = createMenubarAppSystem("/Users/someone", {
      requestQuit: () => {},
      sleep: (ms) => seen.push(ms),
      isRunning: () => {
        alive -= 1;
        return alive > 0;
      },
    });

    system.quitApp();

    expect(alive).toBeLessThanOrEqual(0);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("returns rather than hanging when the app will not go away", () => {
    let slept = 0;
    const system = createMenubarAppSystem("/Users/someone", {
      requestQuit: () => {},
      sleep: () => {
        slept += 1;
      },
      isRunning: () => true,
    });

    system.quitApp();

    // Bounded: the swap and launch get to report their own failure instead.
    expect(slept).toBeLessThanOrEqual(50);
  });
});
