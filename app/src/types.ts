export type Priority = 'P1' | 'P2' | 'P3';

export interface Task {
  id: string;
  title: string;
  summary: string;
  priority: Priority;
  status: 'todo' | 'done';
  plannedDate: string;
  reminderAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  isCanceled: boolean;
  responseStatus: 'accepted' | 'tentative' | 'declined' | 'none';
}

export interface Settings {
  alwaysOnTop: boolean;
  privacyMode: boolean;
  meetingNoticeEnabled: boolean;
  taskRemindersEnabled: boolean;
  launchAtLogin: boolean;
  windowPosition: { x: number; y: number } | null;
}

export interface AppState {
  tasks: Task[];
  events: CalendarEvent[];
  settings: Settings;
  sync: {
    notion: 'disconnected' | 'synced' | 'error';
    microsoft: 'disconnected' | 'synced' | 'error';
    lastSuccessAt: string | null;
    pendingCount: number;
  };
}

export interface DoitAPI {
  getState(): Promise<AppState>;
  createTask(input: {
    title: string;
    summary: string;
    priority: Priority;
    plannedDate: string;
    reminderAt: string | null;
  }): Promise<Task>;
  toggleTask(id: string): Promise<Task>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  setExpanded(expanded: boolean): Promise<void>;
  resetWindowPosition(): Promise<void>;
  onStateChanged(callback: (state: AppState) => void): () => void;
}

declare global {
  interface Window { doit: DoitAPI }
}
