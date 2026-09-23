import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppState, Priority, Task } from './types.js';

const defaults: AppState = {
  tasks: [],
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
      events: Array.isArray(raw.events) ? raw.events : [],
      settings: { ...defaults.settings, ...raw.settings },
      sync: { ...defaults.sync, ...raw.sync },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export async function save(state: AppState) {
  const file = target();
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, file);
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
