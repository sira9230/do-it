export type Priority = 'P1' | 'P2' | 'P3';
export type Status = 'todo' | 'done';

export interface Task {
  id: string;
  title: string;
  summary: string;
  priority: Priority;
  status: Status;
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
