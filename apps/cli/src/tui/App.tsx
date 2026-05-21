import React, { useEffect, useState } from "react";
import { useApp, useInput } from "ink";
import { homedir } from "node:os";
import { join } from "node:path";
import { derivePhaseState } from "./phase-state-machine.js";
import CountdownView from "./CountdownView.js";
import ProjectPickerOverlay from "./ProjectPickerOverlay.js";
import HelpOverlay from "./HelpOverlay.js";
import {
  archiveProject,
  listProjects,
  unarchiveProject,
  upsertProject,
} from "../projects.js";
import { createStateModule, deriveState } from "../state.js";
import { pauseTimer } from "../commands/pause.js";
import { resumeTimer } from "../commands/resume.js";
import { stopTimer } from "../commands/stop.js";
import { initTimer } from "../commands/start.js";

const DEFAULT_DURATION_MS = 25 * 60 * 1_000;
import type { DerivedPhaseState } from "./phase-state-machine.js";
import type { ProjectRecord } from "../projects.js";
import type { StateRecord } from "../state.js";

type Store = ReturnType<typeof createStateModule>;

interface AppProps {
  getProjects?: (opts: { includeArchived: boolean }) => ProjectRecord[];
  upsertProjectFn?: (name: string) => ProjectRecord;
  archiveProjectFn?: (name: string) => void;
  unarchiveProjectFn?: (name: string) => void;
  store?: Store;
  readStateFn?: () => StateRecord | null;
  exitFn?: () => void;
}

const DEFAULT_STATE_DIR = join(homedir(), ".local", "state", "pmdr");

function makeReadOnlyStore(readFn: () => StateRecord | null): Store {
  return {
    readState: readFn,
    writeState: () => {},
    clearState: () => {},
    readCompletions: () => [],
    appendCompletion: () => {},
    finalizeIfExpired: () => {},
    advancePhaseIfExpired: () => {},
    readToday: () => ({}),
    rewriteCompletionProject: () => {},
  } as unknown as Store;
}

export default function App({
  getProjects = (opts) => listProjects(opts),
  upsertProjectFn = upsertProject,
  archiveProjectFn = archiveProject,
  unarchiveProjectFn = unarchiveProject,
  store: providedStore,
  readStateFn,
  exitFn,
}: AppProps) {
  const { exit: inkExit } = useApp();
  const exit = exitFn ?? inkExit;

  const [store] = useState<Store>(
    () =>
      providedStore ??
      (readStateFn
        ? makeReadOnlyStore(readStateFn)
        : createStateModule(DEFAULT_STATE_DIR)),
  );

  const [initial] = useState(() => {
    const now = Date.now();
    const record = store.readState();
    const kind = record ? deriveState({ file: record, now }).kind : "idle";
    return {
      record,
      isAttached: kind === "running" || kind === "paused",
    };
  });

  const [viewState, setViewState] = useState<DerivedPhaseState>(() =>
    derivePhaseState(initial.record, Date.now(), store),
  );
  const [showProjectPicker, setShowProjectPicker] = useState(
    !initial.isAttached,
  );
  const [showHelp, setShowHelp] = useState(false);
  const [currentProject, setCurrentProject] = useState<string | undefined>(
    initial.record?.project,
  );
  const [pickerShowArchived, setPickerShowArchived] = useState(false);
  const [pickerProjects, setPickerProjects] = useState<ProjectRecord[]>(
    initial.isAttached ? [] : getProjects({ includeArchived: false }),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      try {
        store.advancePhaseIfExpired(now);
      } catch {
        // ignore — read-only test stores can no-op
      }
      const record = store.readState();
      setViewState(derivePhaseState(record, now, store));
      setCurrentProject(record?.project);
    }, 500);
    return () => clearInterval(interval);
  }, [store]);

  useInput(
    (input, key) => {
      const now = Date.now();
      if (input === "q" || (key.ctrl && input === "c") || key.escape || input === "\x1B") {
        exit();
      } else if (input === " ") {
        const file = store.readState();
        if (!file) return;
        const derived = deriveState({ file, now });
        try {
          if (derived.kind === "paused") {
            resumeTimer({ store, now });
          } else if (derived.kind === "running") {
            pauseTimer({ store, now });
          }
        } catch {
          // swallow — pauseTimer/resumeTimer throw on idle/conflicting state
        }
        const after = store.readState();
        setViewState(derivePhaseState(after, now, store));
        setCurrentProject(after?.project);
      } else if (input === "x") {
        try {
          stopTimer({ store });
        } catch {
          // ignore — read-only stores or already-empty state
        }
        const after = store.readState();
        setViewState(derivePhaseState(after, now, store));
        setCurrentProject(after?.project);
        setPickerShowArchived(false);
        setPickerProjects(getProjects({ includeArchived: false }));
        setShowProjectPicker(true);
      } else if (input === "p") {
        setPickerShowArchived(false);
        setPickerProjects(getProjects({ includeArchived: false }));
        setShowProjectPicker(true);
      } else if (input === "?") {
        setShowHelp(true);
      }
    },
    { isActive: !showProjectPicker && !showHelp },
  );

  function handleProjectSelect(name: string | null) {
    const now = Date.now();
    const file = store.readState();
    const resolvedName = name === null ? undefined : upsertProjectFn(name).name;
    if (file) {
      const { project: _drop, ...rest } = file;
      store.writeState(
        resolvedName ? { ...rest, project: resolvedName } : rest,
      );
    } else {
      try {
        initTimer({
          store,
          durationMs: DEFAULT_DURATION_MS,
          now,
          project: resolvedName,
        });
      } catch {
        // ignore — read-only stores in tests
      }
    }
    setViewState(derivePhaseState(store.readState(), now, store));
    setCurrentProject(resolvedName);
    setShowProjectPicker(false);
  }

  function handlePickerClose() {
    setShowProjectPicker(false);
  }

  function handleProjectArchive(name: string) {
    archiveProjectFn(name);
    setPickerProjects(getProjects({ includeArchived: pickerShowArchived }));
  }

  function handleProjectUnarchive(name: string) {
    unarchiveProjectFn(name);
    setPickerProjects(getProjects({ includeArchived: pickerShowArchived }));
  }

  function handleToggleShowArchived() {
    setPickerShowArchived((prev) => {
      const next = !prev;
      setPickerProjects(getProjects({ includeArchived: next }));
      return next;
    });
  }

  return (
    <>
      <CountdownView {...viewState} project={currentProject} />
      {showProjectPicker && (
        <ProjectPickerOverlay
          projects={pickerProjects}
          onSelect={handleProjectSelect}
          onClose={handlePickerClose}
          onArchive={handleProjectArchive}
          onUnarchive={handleProjectUnarchive}
          onToggleShowArchived={handleToggleShowArchived}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </>
  );
}
