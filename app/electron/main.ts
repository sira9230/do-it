import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTask, load, save } from './store.js';
import type { AppState, Priority, Settings, Task } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_WIDTH = 360;
const COLLAPSED_HEIGHT = 76;
const EXPANDED_HEIGHT = 560;
const TOP_MARGIN = 16;

let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let state: AppState;
let quitting = false;
let positionSaveTimer: NodeJS.Timeout | null = null;
const reminderTimers = new Map<string, NodeJS.Timeout>();

function centeredPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + (area.width - WINDOW_WIDTH) / 2),
    y: area.y + TOP_MARGIN,
  };
}

function visiblePosition(position: { x: number; y: number }) {
  const bounds = { ...position, width: WINDOW_WIDTH, height: COLLAPSED_HEIGHT };
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    x: Math.min(Math.max(position.x, area.x), area.x + area.width - WINDOW_WIDTH),
    y: Math.min(Math.max(position.y, area.y), area.y + area.height - COLLAPSED_HEIGHT),
  };
}

async function persist() {
  await save(state);
  widgetWindow?.webContents.send('state:changed', state);
}

function cancelReminder(taskId: string) {
  const timer = reminderTimers.get(taskId);
  if (timer) clearTimeout(timer);
  reminderTimers.delete(taskId);
}

function scheduleReminder(task: Task) {
  cancelReminder(task.id);
  if (!state.settings.taskRemindersEnabled || task.status === 'done' || !task.reminderAt) return;

  const delay = new Date(task.reminderAt).getTime() - Date.now();
  if (delay <= 0) return;
  const nextCheckDelay = Math.min(delay, 24 * 60 * 60_000);

  reminderTimers.set(task.id, setTimeout(() => {
    reminderTimers.delete(task.id);
    if (new Date(task.reminderAt!).getTime() > Date.now()) {
      scheduleReminder(task);
      return;
    }
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Do it Widget · 할 일 리마인드',
      body: state.settings.privacyMode ? '설정한 할 일을 확인할 시간이에요.' : task.title,
      silent: false,
    });
    notification.on('click', () => widgetWindow?.show());
    notification.show();
  }, nextCheckDelay));
}

function rescheduleAllReminders() {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  for (const item of state.tasks) scheduleReminder(item);
}

async function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const initialPosition = visiblePosition(state.settings.windowPosition ?? centeredPosition());
  widgetWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: COLLAPSED_HEIGHT,
    minWidth: 320,
    maxWidth: 420,
    minHeight: COLLAPSED_HEIGHT,
    maxHeight: Math.min(EXPANDED_HEIGHT, area.height),
    x: initialPosition.x,
    y: initialPosition.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: state.settings.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      widgetWindow?.hide();
    }
  });
  widgetWindow.on('move', () => {
    if (!widgetWindow) return;
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(() => {
      if (!widgetWindow) return;
      const { x, y } = widgetWindow.getBounds();
      state.settings.windowPosition = visiblePosition({ x, y });
      void save(state);
    }, 250);
  });

  if (process.env.VITE_DEV_SERVER_URL) await widgetWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await widgetWindow.loadFile(path.join(here, '../dist/index.html'));
  widgetWindow.showInactive();
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('✓');
  tray.setToolTip('Do it Widget');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '두잇 위젯 보기', click: () => widgetWindow?.showInactive() },
    { label: '상단 중앙으로 이동', click: () => resetWindowPosition() },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => widgetWindow?.isVisible() ? widgetWindow.hide() : widgetWindow?.showInactive());
}

function resetWindowPosition() {
  const next = centeredPosition();
  state.settings.windowPosition = next;
  widgetWindow?.setPosition(next.x, next.y, true);
  void persist();
}

ipcMain.handle('state:get', () => state);
ipcMain.handle('task:create', async (_event, input: {
  title: string;
  summary: string;
  priority: Priority;
  plannedDate: string;
  reminderAt: string | null;
}) => {
  if (!input.title.trim() || input.title.trim().length > 200) throw new Error('제목은 1~200자로 입력해주세요.');
  if (input.reminderAt && new Date(input.reminderAt).getTime() <= Date.now()) throw new Error('리마인드는 현재보다 뒤의 시간으로 설정해주세요.');
  const next = createTask({ ...input, title: input.title.trim(), summary: input.summary.trim() });
  state.tasks.push(next);
  scheduleReminder(next);
  await persist();
  return next;
});
ipcMain.handle('task:toggle', async (_event, id: string) => {
  const item = state.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error('할 일을 찾을 수 없습니다.');
  const wasDone = item.status === 'done';
  const now = new Date().toISOString();
  item.status = wasDone ? 'todo' : 'done';
  item.completedAt = wasDone ? null : now;
  item.updatedAt = now;
  if (wasDone) scheduleReminder(item); else cancelReminder(item.id);
  await persist();
  return item;
});
ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
  state.settings = { ...state.settings, ...patch };
  widgetWindow?.setAlwaysOnTop(state.settings.alwaysOnTop);
  app.setLoginItemSettings({ openAtLogin: state.settings.launchAtLogin });
  rescheduleAllReminders();
  await persist();
  return state.settings;
});
ipcMain.handle('window:expand', (_event, expanded: boolean) => {
  if (!widgetWindow) return;
  const bounds = widgetWindow.getBounds();
  const maximum = screen.getDisplayMatching(bounds).workArea.height - 40;
  const height = expanded ? Math.min(EXPANDED_HEIGHT, maximum) : COLLAPSED_HEIGHT;
  widgetWindow.setResizable(true);
  widgetWindow.setBounds({ ...bounds, height }, true);
  widgetWindow.setResizable(false);
});
ipcMain.handle('window:reset-position', () => resetWindowPosition());

app.setName('Do it Widget');
app.whenReady().then(async () => {
  state = await load();
  await createWindow();
  createTray();
  rescheduleAllReminders();
  screen.on('display-removed', () => {
    if (!widgetWindow) return;
    const { x, y } = widgetWindow.getBounds();
    const next = visiblePosition({ x, y });
    widgetWindow.setPosition(next.x, next.y);
  });
});
app.on('before-quit', () => { quitting = true; });
app.on('activate', () => widgetWindow?.showInactive());
app.on('window-all-closed', () => {});
