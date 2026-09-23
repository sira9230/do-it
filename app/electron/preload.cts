import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, Priority, Settings, Task } from './types.js';

contextBridge.exposeInMainWorld('doit', {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  createTask: (input: {
    title: string;
    summary: string;
    priority: Priority;
    plannedDate: string;
    reminderAt: string | null;
    notionPageId?: string | null;
  }): Promise<Task> => ipcRenderer.invoke('task:create', input),
  toggleTask: (id: string): Promise<Task> => ipcRenderer.invoke('task:toggle', id),
  setTaskPriority: (id: string, priority: Priority): Promise<Task> => ipcRenderer.invoke('task:priority', id, priority),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
  setExpanded: (expanded: boolean): Promise<void> => ipcRenderer.invoke('window:expand', expanded),
  resetWindowPosition: (): Promise<void> => ipcRenderer.invoke('window:reset-position'),
  connectNotion: (token: string): Promise<number> => ipcRenderer.invoke('notion:connect', token),
  connectMicrosoft: (clientId: string): Promise<{ userCode: string; verificationUri: string }> => ipcRenderer.invoke('microsoft:connect', clientId),
  refreshSync: (): Promise<AppState> => ipcRenderer.invoke('sync:refresh'),
  openHelp: (service: 'notion' | 'microsoft'): Promise<void> => ipcRenderer.invoke('help:open', service),
  openNotionPage: (pageId: string): Promise<void> => ipcRenderer.invoke('notion:open-page', pageId),
  onStateChanged: (callback: (state: AppState) => void) => {
    const handler = (_event: unknown, state: AppState) => callback(state);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
});
