import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppState, Priority, Task } from './types.js';
import { createSerializedJsonWriter } from './state-file.js';

const defaults: AppState = {
  tasks: [],
  taskOrder: [],
  events: [],
  settings: {
    alwaysOnTop: true,
    privacyMode: false,
    meetingNoticeEnabled: true,
    taskRemindersEnabled: true,
    launchAtLogin: false,
    windowPosition: null,
  },
  sync: {
    notion: 'disconnected',
    microsoft: 'disconnected',
    lastSuccessAt: null,
    pendingCount: 0,
  },
};

const target = () => path.join(app.getPath('userData'), 'doit-state.json');
const previousTarget = () => path.join(app.getPath('appData'), 'Do it Widget', 'doit-state.json');
const writeState = createSerializedJsonWriter();

export async function load(): Promise<AppState> {
  try {
    let content: string;
    try { content = await readFile(target(), 'utf8'); }
    catch { content = await readFile(previousTarget(), 'utf8'); }
    const raw = JSON.parse(content) as Partial<AppState>;
    return {
      ...defaults,
      ...raw,
      tasks: Array.isArray(raw.tasks)
        ? raw.tasks.map((item) => ({ ...item, reminderAt: item.reminderAt ?? null }))
        : [],
      taskOrder: Array.isArray(raw.taskOrder) ? raw.taskOrder.filter((id): id is string => typeof id === 'string') : [],
      events: Array.isArray(raw.events) ? raw.events : [],
      settings: { ...defaults.settings, ...raw.settings },
      sync: { ...defaults.sync, ...raw.sync },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export function save(state: AppState) {
  return writeState(target(), state);
}

export function createTask(input: {
  title: string;
  summary: string;
  priority: Priority;
  plannedDate: string;
  reminderAt: string | null;
}): Task {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    status: 'todo',
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}
