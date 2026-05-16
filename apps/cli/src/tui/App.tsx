import React, { useEffect, useMemo, useState } from "react";
import { useApp, useInput } from "ink";
import { createPhaseStateMachine } from "./phase-state-machine.js";
import CountdownView from "./CountdownView.js";
import type { DerivedPhaseState } from "./phase-state-machine.js";

export default function App() {
  const { exit } = useApp();
  const machine = useMemo(() => createPhaseStateMachine(Date.now()), []);

  const [viewState, setViewState] = useState<DerivedPhaseState>(() =>
    machine.getState(Date.now()),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      machine.tick(now);
      setViewState(machine.getState(now));
    }, 500);
    return () => clearInterval(interval);
  }, [machine]);

  useInput((input, key) => {
    const now = Date.now();
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    } else if (input === " ") {
      const state = machine.getState(now);
      if (state.paused) {
        machine.resume(now);
      } else {
        machine.pause(now);
      }
      setViewState(machine.getState(now));
    } else if (input === "s") {
      machine.skip(now);
      setViewState(machine.getState(now));
    }
  });

  return <CountdownView {...viewState} />;
}
