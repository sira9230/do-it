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
  notionPageId?: string;
  notionBlockId?: string;
  sourcePageTitle?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  source?: 'notion' | 'microsoft';
  isAllDay?: boolean;
  isMeeting?: boolean;
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
    notionError?: string | null;
    microsoftError?: string | null;
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
    notionPageId?: string | null;
  }): Promise<Task>;
  updateTask(input: { id: string; title: string; summary: string }): Promise<Task>;
  toggleTask(id: string): Promise<Task>;
  setTaskPriority(id: string, priority: Priority): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  restoreTask(task: Task): Promise<void>;
  showHoverCount(count: number | null): Promise<void>;
  setPreviewHovered(hovered: boolean, count: number): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  setExpanded(expanded: boolean): Promise<void>;
  quitApp(): Promise<void>;
  resetWindowPosition(): Promise<void>;
  connectNotion(token: string): Promise<number>;
  connectMicrosoft(clientId: string): Promise<{ userCode: string; verificationUri: string }>;
  refreshSync(): Promise<AppState>;
  openHelp(service: 'notion' | 'microsoft'): Promise<void>;
  openNotionPage(pageId: string): Promise<void>;
  onStateChanged(callback: (state: AppState) => void): () => void;
}

declare global {
  interface Window { doit: DoitAPI }
}
