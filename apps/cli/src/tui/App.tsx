import React, { useEffect, useState } from "react";
import { useApp, useInput } from "ink";
import { createPhaseStateMachine } from "./phase-state-machine.js";
import CountdownView from "./CountdownView.js";
import ProjectPickerOverlay from "./ProjectPickerOverlay.js";
import HelpOverlay from "./HelpOverlay.js";
import { listProjects, upsertProject } from "../projects.js";
import { readState, deriveState } from "../state.js";
import type { DerivedPhaseState, InitialMachineState } from "./phase-state-machine.js";
import type { ProjectRecord } from "../projects.js";
import type { StateRecord } from "../state.js";

interface AppProps {
  getProjects?: () => ProjectRecord[];
  upsertProjectFn?: (name: string) => ProjectRecord;
  readStateFn?: () => StateRecord | null;
  exitFn?: () => void;
}

interface AppInit {
  machine: ReturnType<typeof createPhaseStateMachine>;
  showProjectPicker: boolean;
  pickerProjects: ProjectRecord[];
  currentProject: string | undefined;
}

function buildAppInit(
  readStateFn: () => StateRecord | null,
  getProjects: () => ProjectRecord[],
): AppInit {
  const now = Date.now();
  const record = readStateFn();
  const kind = record ? deriveState({ file: record, now }).kind : "idle";

  if (record && (kind === "running" || kind === "paused")) {
    const seed: InitialMachineState = {
      phase: "focus",
      phaseStartedAt: record.startedAt,
      phaseDurationMs: record.durationMs,
      pausedAt: record.pausedAt,
      accumulatedPauseMs: record.accumulatedPauseMs,
      completedFocusBlocks: 0,
      project: record.project,
    };
    return {
      machine: createPhaseStateMachine(now, { initialState: seed }),
      showProjectPicker: false,
      pickerProjects: [],
      currentProject: record.project,
    };
  }

  return {
    machine: createPhaseStateMachine(now),
    showProjectPicker: true,
    pickerProjects: getProjects(),
    currentProject: undefined,
  };
}

export default function App({
  getProjects = () => listProjects({ includeArchived: false }),
  upsertProjectFn = upsertProject,
  readStateFn = readState,
  exitFn,
}: AppProps) {
  const { exit: inkExit } = useApp();
  const exit = exitFn ?? inkExit;

  const [{ machine, showProjectPicker: initPicker, pickerProjects: initPickerProjects, currentProject: initProject }] = useState(
    () => buildAppInit(readStateFn, getProjects),
  );

  const [viewState, setViewState] = useState<DerivedPhaseState>(() =>
    machine.getState(Date.now()),
  );
  const [showProjectPicker, setShowProjectPicker] = useState(initPicker);
  const [showHelp, setShowHelp] = useState(false);
  const [currentProject, setCurrentProject] = useState<string | undefined>(initProject);
  const [pickerProjects, setPickerProjects] = useState<ProjectRecord[]>(initPickerProjects);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      machine.tick(now);
      setViewState(machine.getState(now));
    }, 500);
    return () => clearInterval(interval);
  }, [machine]);

  useInput(
    (input, key) => {
      const now = Date.now();
      if (input === "q" || (key.ctrl && input === "c") || key.escape || input === "\x1B") {
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
      } else if (input === "p") {
        setPickerProjects(getProjects());
        setShowProjectPicker(true);
      } else if (input === "?") {
        setShowHelp(true);
      }
    },
    { isActive: !showProjectPicker && !showHelp },
  );

  function handleProjectSelect(name: string) {
    const record = upsertProjectFn(name);
    machine.setProject(record.name);
    setCurrentProject(record.name);
    setShowProjectPicker(false);
  }

  function handlePickerClose() {
    setShowProjectPicker(false);
  }

  return (
    <>
      <CountdownView {...viewState} project={currentProject} />
      {showProjectPicker && (
        <ProjectPickerOverlay
          projects={pickerProjects}
          onSelect={handleProjectSelect}
          onClose={handlePickerClose}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </>
  );
}
