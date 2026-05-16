import React, { useEffect, useMemo, useState } from "react";
import { useApp, useInput } from "ink";
import { createPhaseStateMachine } from "./phase-state-machine.js";
import CountdownView from "./CountdownView.js";
import ProjectPickerOverlay from "./ProjectPickerOverlay.js";
import HelpOverlay from "./HelpOverlay.js";
import { listProjects, upsertProject } from "../projects.js";
import type { DerivedPhaseState } from "./phase-state-machine.js";
import type { ProjectRecord } from "../projects.js";

interface AppProps {
  getProjects?: () => ProjectRecord[];
  upsertProjectFn?: (name: string) => ProjectRecord;
}

export default function App({
  getProjects = () => listProjects({ includeArchived: false }),
  upsertProjectFn = upsertProject,
}: AppProps) {
  const { exit } = useApp();
  const machine = useMemo(() => createPhaseStateMachine(Date.now()), []);

  const [viewState, setViewState] = useState<DerivedPhaseState>(() =>
    machine.getState(Date.now()),
  );
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [currentProject, setCurrentProject] = useState<string | undefined>(undefined);
  const [pickerProjects, setPickerProjects] = useState<ProjectRecord[]>([]);

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
