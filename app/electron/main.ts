import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTask, load, save } from './store.js';
import { appendNotionTodo, deleteNotionTodo, fetchMicrosoftEvents, fetchNotionData, readCredentials, refreshMicrosoftToken, restoreNotionTodo, startMicrosoftSignIn, updateNotionTodo, updateNotionTodoPriority, updateNotionTodoTitle, waitForMicrosoftSignIn, writeCredentials } from './integrations.js';
import type { AppState, CalendarEvent, Priority, Settings, Task } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_WIDTH = 316;
const EXPANDED_WIDTH = 432;
const COLLAPSED_HEIGHT = 64;
const PREVIEW_HEIGHT = 124;
const EXPANDED_HEIGHT = 620;
const TOP_MARGIN = 16;

let widgetWindow: BrowserWindow | null = null;
let hoverWindow: BrowserWindow | null = null;
let hoverRequestVersion = 0;
let windowExpanded = false;
let resizingWindow = false;
let resizeVersion = 0;
let expansionOrigin: { collapsedX: number; collapsedY: number; expandedX: number; expandedY: number } | null = null;
let tray: Tray | null = null;
let state: AppState;
let quitting = false;
let positionSaveTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
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

function positionHoverWindow() {
  if (!widgetWindow || !hoverWindow) return;
  const bounds = widgetWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.round(bounds.x + (bounds.width - 156) / 2);
  const y = bounds.y + bounds.height + 3 + 39 <= area.y + area.height
    ? bounds.y + bounds.height + 3 : bounds.y - 42;
  hoverWindow.setPosition(x, y, false);
}

async function createHoverWindow() {
  hoverWindow = new BrowserWindow({
    width: 156, height: 39, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true, show: false, alwaysOnTop: state.settings.alwaysOnTop,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  hoverWindow.setIgnoreMouseEvents(true);
  hoverWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,sans-serif}body{display:grid;place-items:center;height:39px}.pill{display:flex;align-items:center;gap:9px;padding:8px 14px;border-radius:999px;background:#fff;color:#747b86;font-size:12px;letter-spacing:.01em;box-shadow:0 9px 33px rgba(0,0,0,.065);white-space:nowrap}.pill b{color:#3674e9;font-size:13px;font-weight:700}</style></head><body><div class="pill">남은 할 일 <b id="count">0개</b></div></body></html>';
  await hoverWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
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
      title: 'Do it · 할 일 리마인드',
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
  const savedPosition = state.settings.windowPosition;
  const oldCenteredX = Math.round(area.x + (area.width - 360) / 2);
  const preferredPosition = savedPosition && Math.abs(savedPosition.x - oldCenteredX) <= 4
    ? { ...savedPosition, x: centeredPosition().x }
    : savedPosition ?? centeredPosition();
  const initialPosition = visiblePosition(preferredPosition);
  widgetWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: COLLAPSED_HEIGHT,
    minWidth: 280,
    maxWidth: EXPANDED_WIDTH,
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
      hoverWindow?.hide();
    }
  });
  widgetWindow.on('move', () => {
    positionHoverWindow();
    if (!widgetWindow || resizingWindow) return;
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(() => {
      if (!widgetWindow) return;
      const { x, y } = widgetWindow.getBounds();
      state.settings.windowPosition = visiblePosition(windowExpanded && expansionOrigin
        ? { x: expansionOrigin.collapsedX + x - expansionOrigin.expandedX, y: expansionOrigin.collapsedY + y - expansionOrigin.expandedY }
        : { x, y });
      void save(state);
    }, 250);
  });

  if (process.env.VITE_DEV_SERVER_URL) await widgetWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await widgetWindow.loadFile(path.join(here, '../dist/index.html'));
  await createHoverWindow();
  widgetWindow.showInactive();
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('✓');
  tray.setToolTip('Do it');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '두잇 위젯 보기', click: () => widgetWindow?.showInactive() },
    { label: '상단 중앙으로 이동', click: () => resetWindowPosition() },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (widgetWindow?.isVisible()) { widgetWindow.hide(); hoverWindow?.hide(); }
    else widgetWindow?.showInactive();
  });
}

function resetWindowPosition() {
  const next = centeredPosition();
  state.settings.windowPosition = next;
  if (widgetWindow) {
    const bounds = widgetWindow.getBounds();
    const x = windowExpanded && expansionOrigin ? expansionOrigin.expandedX + next.x - expansionOrigin.collapsedX : next.x;
    const y = windowExpanded && expansionOrigin ? expansionOrigin.expandedY + next.y - expansionOrigin.collapsedY : next.y;
    widgetWindow.setPosition(x, y, true);
  }
  void persist();
}

function replaceEvents(source: 'notion' | 'microsoft', events: CalendarEvent[]) {
  state.events = [...state.events.filter((event) => event.source !== source), ...events]
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function replaceNotionTasks(tasks: Task[]) {
  const previous = new Map(state.tasks.filter((task) => task.notionBlockId).map((task) => [task.id, task]));
  state.tasks = [...state.tasks.filter((task) => !task.notionBlockId), ...tasks.map((task) => {
    const local = previous.get(task.id);
    return { ...task, reminderAt: local?.reminderAt ?? null };
  })];
  rescheduleAllReminders();
}

async function refreshNotion() {
  const { notionToken } = await readCredentials();
  if (!notionToken) return;
  try {
    const data = await fetchNotionData(notionToken);
    replaceEvents('notion', data.events);
    replaceNotionTasks(data.tasks);
    state.sync.notion = 'synced';
    state.sync.notionError = null;
    state.sync.lastSuccessAt = new Date().toISOString();
  } catch (error) {
    state.sync.notion = 'error';
    state.sync.notionError = error instanceof Error ? error.message : 'Notion 동기화에 실패했습니다.';
  }
  await persist();
}

async function refreshMicrosoft() {
  const { microsoftClientId, microsoftRefreshToken } = await readCredentials();
  if (!microsoftClientId || !microsoftRefreshToken) return;
  try {
    const token = await refreshMicrosoftToken(microsoftClientId, microsoftRefreshToken);
    if (!token.access_token) throw new Error('Microsoft 인증 정보를 갱신하지 못했습니다.');
    if (token.refresh_token) await writeCredentials({ microsoftRefreshToken: token.refresh_token });
    replaceEvents('microsoft', await fetchMicrosoftEvents(token.access_token));
    state.sync.microsoft = 'synced';
    state.sync.microsoftError = null;
    state.sync.lastSuccessAt = new Date().toISOString();
  } catch (error) {
    state.sync.microsoft = 'error';
    state.sync.microsoftError = error instanceof Error ? error.message : 'Microsoft 일정 동기화에 실패했습니다.';
  }
  await persist();
}

ipcMain.handle('notion:connect', async (_event, token: string) => {
  if (!token.trim()) throw new Error('Notion 통합 토큰을 입력해주세요.');
  const data = await fetchNotionData(token.trim());
  await writeCredentials({ notionToken: token.trim() });
  replaceEvents('notion', data.events);
  replaceNotionTasks(data.tasks);
  state.sync.notion = 'synced';
  state.sync.notionError = null;
  state.sync.lastSuccessAt = new Date().toISOString();
  await persist();
  return data.events.length;
});
ipcMain.handle('microsoft:connect', async (_event, clientId: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(clientId.trim())) throw new Error('Microsoft 앱 클라이언트 ID를 확인해주세요.');
  const device = await startMicrosoftSignIn(clientId.trim());
  void shell.openExternal(device.verification_uri);
  void waitForMicrosoftSignIn(clientId.trim(), device).then(async (token) => {
    if (!token.access_token || !token.refresh_token) throw new Error('Microsoft 인증 정보가 누락됐습니다.');
    await writeCredentials({ microsoftClientId: clientId.trim(), microsoftRefreshToken: token.refresh_token });
    replaceEvents('microsoft', await fetchMicrosoftEvents(token.access_token));
    state.sync.microsoft = 'synced';
    state.sync.microsoftError = null;
    state.sync.lastSuccessAt = new Date().toISOString();
    await persist();
  }).catch(async (error) => {
    state.sync.microsoft = 'error';
    state.sync.microsoftError = error instanceof Error ? error.message : 'Microsoft 로그인에 실패했습니다.';
    await persist();
  });
  return { userCode: device.user_code, verificationUri: device.verification_uri };
});
ipcMain.handle('sync:refresh', async () => {
  await Promise.allSettled([refreshNotion(), refreshMicrosoft()]);
  return state;
});
ipcMain.handle('help:open', (_event, service: 'notion' | 'microsoft') => {
  const urls = {
    notion: 'https://developers.notion.com/guides/get-started/quick-start',
    microsoft: 'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app',
  };
  if (!Object.hasOwn(urls, service)) throw new Error('지원하지 않는 도움말입니다.');
  return shell.openExternal(urls[service]);
});
ipcMain.handle('notion:open-page', (_event, pageId: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)) throw new Error('Notion 페이지 ID를 확인해주세요.');
  return shell.openExternal(`https://app.notion.com/p/${pageId.replaceAll('-', '')}`);
});

ipcMain.handle('state:get', () => state);
ipcMain.handle('task:create', async (_event, input: {
  title: string;
  summary: string;
  priority: Priority;
  plannedDate: string;
  reminderAt: string | null;
  notionPageId?: string | null;
}) => {
  if (!input.title.trim() || input.title.trim().length > 200) throw new Error('제목은 1~200자로 입력해주세요.');
  if (input.reminderAt && new Date(input.reminderAt).getTime() <= Date.now()) throw new Error('리마인드는 현재보다 뒤의 시간으로 설정해주세요.');
  const next = createTask({ ...input, title: input.title.trim(), summary: input.summary.trim() });
  if (input.notionPageId) {
    const page = state.events.find((event) => event.id === `notion:${input.notionPageId}`);
    if (!page) throw new Error('선택한 Notion 회의록 페이지를 찾을 수 없습니다.');
    const { notionToken } = await readCredentials();
    if (!notionToken) throw new Error('Notion 연결 정보를 찾을 수 없습니다.');
    const blockId = await appendNotionTodo(notionToken, input.notionPageId, next.title, next.priority);
    next.id = `notion:${blockId}`;
    next.notionPageId = input.notionPageId;
    next.notionBlockId = blockId;
  }
  state.tasks.push(next);
  scheduleReminder(next);
  await persist();
  return next;
});
ipcMain.handle('task:update', async (_event, input: { id: string; title: string; summary: string }) => {
  const item = state.tasks.find((candidate) => candidate.id === input.id);
  if (!item) throw new Error('수정할 할 일을 찾을 수 없습니다.');
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title || title.length > 200) throw new Error('할 일은 1~200자로 입력해주세요.');
  if (summary.length > 500) throw new Error('설명은 500자 이하로 입력해주세요.');
  let notionTitleChanged = false;
  if (item.notionBlockId && item.title !== title) {
    const { notionToken } = await readCredentials();
    if (!notionToken) throw new Error('Notion 연결 정보를 찾을 수 없습니다.');
    await updateNotionTodoTitle(notionToken, item.notionBlockId, title);
    notionTitleChanged = true;
  }
  item.title = title;
  if (!item.notionBlockId) item.summary = summary;
  item.updatedAt = new Date().toISOString();
  await persist();
  if (notionTitleChanged) void refreshNotion();
  return item;
});
ipcMain.handle('task:toggle', async (_event, id: string) => {
  const item = state.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error('할 일을 찾을 수 없습니다.');
  const wasDone = item.status === 'done';
  if (item.notionBlockId) {
    const { notionToken } = await readCredentials();
    if (!notionToken) throw new Error('Notion 연결 정보를 찾을 수 없습니다.');
    await updateNotionTodo(notionToken, item.notionBlockId, wasDone);
  }
  const now = new Date().toISOString();
  item.status = wasDone ? 'todo' : 'done';
  item.completedAt = wasDone ? null : now;
  item.updatedAt = now;
  if (wasDone) scheduleReminder(item); else cancelReminder(item.id);
  await persist();
  return item;
});
ipcMain.handle('task:priority', async (_event, id: string, priority: Priority) => {
  if (!['P1', 'P2', 'P3'].includes(priority)) throw new Error('중요도를 확인해주세요.');
  const item = state.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error('할 일을 찾을 수 없습니다.');
  if (item.notionBlockId) {
    const { notionToken } = await readCredentials();
    if (!notionToken) throw new Error('Notion 연결 정보를 찾을 수 없습니다.');
    await updateNotionTodoPriority(notionToken, item.notionBlockId, priority);
  }
  item.priority = priority;
  item.updatedAt = new Date().toISOString();
  await persist();
  return item;
});
ipcMain.handle('task:delete', async (_event, id: string) => {
  const item = state.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error('삭제할 할 일을 찾을 수 없습니다.');
  if (item.notionBlockId) {
    const { notionToken } = await readCredentials();
    if (!notionToken) throw new Error('Notion 연결 정보를 찾을 수 없습니다.');
    await deleteNotionTodo(notionToken, item.notionBlockId);
  }
  state.tasks = state.tasks.filter((candidate) => candidate.id !== id);
  cancelReminder(id);
  await persist();
});
ipcMain.handle('task:restore', async (_event, task: Task) => {
  if (!task?.id || state.tasks.some((candidate) => candidate.id === task.id)) throw new Error('되돌릴 할 일을 찾을 수 없습니다.');
  if (task.notionBlockId) {
    const { notionToken } = await readCredentials();
    if (!notionToken) throw new Error('Notion 연결 정보를 찾을 수 없습니다.');
    await restoreNotionTodo(notionToken, task.notionBlockId);
  }
  state.tasks.push(task);
  scheduleReminder(task);
  await persist();
});
ipcMain.handle('widget:hover-count', async (_event, count: number | null) => {
  const version = ++hoverRequestVersion;
  if (!hoverWindow || !widgetWindow || count === null || !Number.isInteger(count) || count < 0 || !widgetWindow.isVisible() || widgetWindow.getBounds().height > PREVIEW_HEIGHT) {
    hoverWindow?.hide();
    return;
  }
  await hoverWindow.webContents.executeJavaScript(`document.getElementById('count').textContent = ${JSON.stringify(`${count}개`)}`);
  if (version !== hoverRequestVersion) return;
  positionHoverWindow();
  hoverWindow.showInactive();
});
ipcMain.handle('window:preview-hover', (_event, hovered: boolean, count: number) => {
  if (!widgetWindow) return;
  if (windowExpanded) return;
  const bounds = widgetWindow.getBounds();
  if (bounds.height > PREVIEW_HEIGHT) return;
  const area = screen.getDisplayMatching(bounds).workArea;
  const cards = Number.isInteger(count) ? Math.max(1, Math.min(3, count)) : 1;
  const preferredHeight = [COLLAPSED_HEIGHT, 94, PREVIEW_HEIGHT][cards - 1];
  const height = hovered ? Math.max(COLLAPSED_HEIGHT, Math.min(preferredHeight, area.y + area.height - bounds.y - 45)) : COLLAPSED_HEIGHT;
  if (bounds.height === height) return;
  widgetWindow.setResizable(true);
  widgetWindow.setBounds({ ...bounds, height }, true);
  widgetWindow.setResizable(false);
  positionHoverWindow();
});
ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
  state.settings = { ...state.settings, ...patch };
  widgetWindow?.setAlwaysOnTop(state.settings.alwaysOnTop);
  hoverWindow?.setAlwaysOnTop(state.settings.alwaysOnTop);
  app.setLoginItemSettings({ openAtLogin: state.settings.launchAtLogin });
  rescheduleAllReminders();
  await persist();
  return state.settings;
});
ipcMain.handle('window:expand', (_event, expanded: boolean) => {
  if (!widgetWindow) return;
  if (expanded) hoverWindow?.hide();
  const bounds = widgetWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = expanded ? Math.min(EXPANDED_WIDTH, area.width - 24) : WINDOW_WIDTH;
  const height = expanded ? Math.min(EXPANDED_HEIGHT, area.height - 16) : COLLAPSED_HEIGHT;
  let x: number;
  let y: number;
  if (expanded) {
    x = Math.min(Math.max(Math.round(bounds.x + (bounds.width - width) / 2), area.x), area.x + area.width - width);
    y = Math.min(Math.max(Math.round(bounds.y + (COLLAPSED_HEIGHT - height) / 2), area.y), area.y + area.height - height);
    expansionOrigin = { collapsedX: bounds.x, collapsedY: bounds.y, expandedX: x, expandedY: y };
  } else if (expansionOrigin) {
    x = Math.min(Math.max(expansionOrigin.collapsedX + bounds.x - expansionOrigin.expandedX, area.x), area.x + area.width - width);
    y = Math.min(Math.max(expansionOrigin.collapsedY + bounds.y - expansionOrigin.expandedY, area.y), area.y + area.height - height);
  } else {
    x = Math.round(bounds.x + (bounds.width - width) / 2);
    y = bounds.y;
  }
  windowExpanded = expanded;
  resizingWindow = true;
  const version = ++resizeVersion;
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  widgetWindow.setResizable(true);
  widgetWindow.setBounds({ x, y: bounds.y, width, height }, true);
  widgetWindow.setResizable(false);
  setTimeout(() => { if (version === resizeVersion) resizingWindow = false; }, 750);
  if (!expanded) {
    state.settings.windowPosition = visiblePosition({ x, y });
    void save(state);
    expansionOrigin = null;
  }
  positionHoverWindow();
});
ipcMain.handle('window:quit', () => { quitting = true; app.quit(); });
ipcMain.handle('window:reset-position', () => resetWindowPosition());

app.setName('Do it');
app.whenReady().then(async () => {
  state = await load();
  await createWindow();
  createTray();
  rescheduleAllReminders();
  void Promise.allSettled([refreshNotion(), refreshMicrosoft()]);
  syncTimer = setInterval(() => { void Promise.allSettled([refreshNotion(), refreshMicrosoft()]); }, 5 * 60_000);
  screen.on('display-removed', () => {
    if (!widgetWindow) return;
    const { x, y } = widgetWindow.getBounds();
    const next = visiblePosition({ x, y });
    widgetWindow.setPosition(next.x, next.y);
  });
});
app.on('before-quit', () => { quitting = true; if (syncTimer) clearInterval(syncTimer); });
app.on('activate', () => widgetWindow?.showInactive());
app.on('window-all-closed', () => {});
