import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CalendarEvent, Priority, Task } from './types.js';
import { inlinePriority, isPriorityCode, replaceVisibleTitle, visibleText, writableRichText } from './notion-rich-text.js';
import type { NotionRichText } from './notion-rich-text.js';

const NOTION_DATA_SOURCE = '159563d4-3059-8187-9a21-000b9c31881e';
const NOTION_VERSION = '2025-09-03';
const MICROSOFT_SCOPE = 'openid profile offline_access Calendars.Read';

interface Credentials {
  notionToken?: string;
  microsoftClientId?: string;
  microsoftRefreshToken?: string;
}

const credentialsPath = () => path.join(app.getPath('userData'), 'doit-credentials.bin');

export async function readCredentials(): Promise<Credentials> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    return JSON.parse(safeStorage.decryptString(await readFile(credentialsPath()))) as Credentials;
  } catch {
    return {};
  }
}

export async function writeCredentials(patch: Partial<Credentials>) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS 보안 저장소를 사용할 수 없습니다.');
  const next = { ...await readCredentials(), ...patch };
  await mkdir(path.dirname(credentialsPath()), { recursive: true });
  await writeFile(credentialsPath(), safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
}

async function responseJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as T & { message?: string; error?: string; error_description?: string };
  if (!response.ok) throw new Error(body.message ?? body.error_description ?? body.error ?? `요청 실패 (${response.status})`);
  return body;
}

interface NotionPage {
  id: string;
  archived?: boolean;
  created_time?: string;
  last_edited_time?: string;
  properties: {
    Name?: { title?: { plain_text?: string }[] };
    날짜?: { date?: { start: string; end?: string | null } | null };
    중요도?: { select?: { name: string } | null; status?: { name: string } | null };
  };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  last_edited_time?: string;
  to_do?: { checked: boolean; color?: string; rich_text: NotionRichText[] };
  paragraph?: { rich_text: NotionRichText[] };
  bulleted_list_item?: { rich_text: NotionRichText[] };
  numbered_list_item?: { rich_text: NotionRichText[] };
  heading_1?: { rich_text: NotionRichText[] };
  heading_2?: { rich_text: NotionRichText[] };
  heading_3?: { rich_text: NotionRichText[] };
}

interface ContextualBlock { block: NotionBlock; description: string }

function blockRichText(block: NotionBlock): NotionRichText[] {
  return block.to_do?.rich_text ?? block.paragraph?.rich_text ?? block.bulleted_list_item?.rich_text
    ?? block.numbered_list_item?.rich_text ?? block.heading_1?.rich_text ?? block.heading_2?.rich_text
    ?? block.heading_3?.rich_text ?? [];
}

function blockText(block: NotionBlock) {
  return visibleText(blockRichText(block));
}

function blockPriority(block: NotionBlock): Priority {
  const code = inlinePriority(block.to_do?.rich_text ?? []);
  if (code) return code;
  return notionPriority(block.to_do?.color);
}

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function dateString(value: string) {
  if (!value.includes('T')) return value;
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function notionPriority(value?: string): Priority {
  if (value === 'red_background' || value === 'red') return 'P1';
  if (value === 'gray_background' || value === 'gray') return 'P3';
  return 'P2';
}

function parseMeetingLine(value: string, day: string, pageId: string, blockId: string): CalendarEvent | null {
  const match = value.trim().match(/^(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*시?\s*(?:[~～\-–]\s*(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*시?)?\s+(.+)$/);
  if (!match) return null;
  const title = match[7].trim();
  if (!/(회의|미팅|면담|콜|워크숍)/.test(title)) return null;
  const toHour = (hour: number, meridiem?: string) => {
    if (meridiem === '오전') return hour === 12 ? 0 : hour;
    if (meridiem === '오후') return hour === 12 ? 12 : hour % 12 + 12;
    return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  };
  const startHour = toHour(Number(match[2]), match[1]);
  const startMinute = Number(match[3] ?? 0);
  if (startHour > 23 || startMinute > 59) return null;
  const start = new Date(`${day}T00:00:00`);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(start);
  if (match[5]) {
    const endHour = toHour(Number(match[5]), match[4]);
    const endMinute = Number(match[6] ?? 0);
    if (endHour > 23 || endMinute > 59) return null;
    end.setHours(endHour, endMinute, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
  } else end.setHours(end.getHours() + 1);
  return {
    id: `notion-item:${pageId}:${blockId}`,
    title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    source: 'notion',
    isMeeting: true,
    isAllDay: false,
    isCanceled: false,
    responseStatus: 'none',
  };
}

async function fetchPageBlocks(token: string, blockId: string, depth = 0, inheritedDescription = ''): Promise<ContextualBlock[]> {
  if (depth > 5) return [];
  const found: ContextualBlock[] = [];
  let heading = inheritedDescription;
  let cursor: string | undefined;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const data = await responseJson<{ results: NotionBlock[]; has_more: boolean; next_cursor: string | null }>(
      url.toString(), { headers: notionHeaders(token) },
    );
    for (const block of data.results) {
      if (/^heading_[123]$/.test(block.type)) heading = blockText(block) || heading;
      found.push({ block, description: heading });
      if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const parentTitle = blockText(block);
        found.push(...await fetchPageBlocks(token, block.id, depth + 1, parentTitle || heading));
      }
    }
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return found;
}

export async function fetchNotionData(token: string): Promise<{ events: CalendarEvent[]; tasks: Task[] }> {
  const headers = {
    ...notionHeaders(token),
  };
  const events: CalendarEvent[] = [];
  const tasks: Task[] = [];
  let cursor: string | undefined;
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 1);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 31);
  const dateFilter = {
    and: [
      { property: '날짜', date: { on_or_after: dateString(windowStart.toISOString()) } },
      { property: '날짜', date: { on_or_before: dateString(windowEnd.toISOString()) } },
    ],
  };
  do {
    const data = await responseJson<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(
      `https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE}/query`,
      { method: 'POST', headers, body: JSON.stringify({ page_size: 100, filter: dateFilter, ...(cursor ? { start_cursor: cursor } : {}) }) },
    );
    for (const page of data.results) {
      if (page.archived) continue;
      const date = page.properties['날짜']?.date;
      if (!date?.start) continue;
      const isAllDay = !date.start.includes('T');
      const startAt = isAllDay ? `${date.start}T00:00:00` : date.start;
      const endAt = date.end
        ? (isAllDay && !date.end.includes('T') ? `${date.end}T23:59:59` : date.end)
        : (isAllDay ? `${date.start}T23:59:59` : new Date(new Date(date.start).getTime() + 60 * 60_000).toISOString());
      events.push({
        id: `notion:${page.id}`,
        title: page.properties.Name?.title?.map((part) => part.plain_text ?? '').join('') || '이름 없는 일정',
        startAt,
        endAt,
        source: 'notion',
        isAllDay,
        isCanceled: false,
        responseStatus: 'none',
        isMeeting: true,
      });
      if (dateString(date.start) === dateString(now.toISOString())) {
        const pageTitle = page.properties.Name?.title?.map((part) => part.plain_text ?? '').join('') || '회의록';
        for (const { block, description } of await fetchPageBlocks(token, page.id)) {
          const content = blockText(block);
          const meeting = parseMeetingLine(content, dateString(date.start), page.id, block.id);
          if (meeting) events.push(meeting);
          if (block.type !== 'to_do') continue;
          const title = blockText(block);
          if (!title) continue;
          const updatedAt = block.last_edited_time ?? page.last_edited_time ?? new Date().toISOString();
          tasks.push({
            id: `notion:${block.id}`,
            notionPageId: page.id,
            notionBlockId: block.id,
            sourcePageTitle: pageTitle,
            title,
            summary: description,
            priority: blockPriority(block),
            status: block.to_do?.checked ? 'done' : 'todo',
            plannedDate: dateString(date.start),
            reminderAt: null,
            completedAt: block.to_do?.checked ? updatedAt : null,
            createdAt: page.created_time ?? updatedAt,
            updatedAt,
          });
        }
      }
    }
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return { events, tasks };
}

export async function updateNotionTodo(token: string, blockId: string, checked: boolean) {
  await responseJson(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ to_do: { checked } }),
  });
}

export async function deleteNotionTodo(token: string, blockId: string) {
  await responseJson(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE', headers: notionHeaders(token),
  });
}

export async function restoreNotionTodo(token: string, blockId: string) {
  await responseJson(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH', headers: notionHeaders(token), body: JSON.stringify({ in_trash: false }),
  });
}

export async function updateNotionTodoPriority(token: string, blockId: string, priority: Priority) {
  const color = priority === 'P1' ? 'red_background' : priority === 'P3' ? 'gray_background' : 'blue_background';
  const current = await responseJson<NotionBlock>(`https://api.notion.com/v1/blocks/${blockId}`, { headers: notionHeaders(token) });
  if (current.type !== 'to_do' || !current.to_do) throw new Error('Notion 체크박스를 찾을 수 없습니다.');
  const richText = current.to_do.rich_text.map((part) => {
    const writable = writableRichText(part);
    if (isPriorityCode(part) && writable.text) return { ...writable, text: { ...writable.text, content: writable.text.content.replace(/P[123]/i, priority) } };
    return writable;
  });
  if (!current.to_do.rich_text.some(isPriorityCode)) {
    richText.push({ type: 'text', text: { content: ' ' } });
    richText.push({ type: 'text', text: { content: priority }, annotations: { code: true } });
  }
  await responseJson(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ to_do: { color, rich_text: richText } }),
  });
}

export async function updateNotionTodoTitle(token: string, blockId: string, title: string) {
  const current = await responseJson<NotionBlock>(`https://api.notion.com/v1/blocks/${blockId}`, { headers: notionHeaders(token) });
  if (current.type !== 'to_do' || !current.to_do) throw new Error('Notion 체크박스를 찾을 수 없습니다.');
  if (blockText(current) === title) return;
  await responseJson(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ to_do: { rich_text: replaceVisibleTitle(current.to_do.rich_text, title) } }),
  });
}

export async function appendNotionTodo(token: string, pageId: string, title: string, priority: Priority): Promise<string> {
  const color = priority === 'P1' ? 'red_background' : priority === 'P3' ? 'gray_background' : 'blue_background';
  const result = await responseJson<{ results: { id: string }[] }>(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({
        children: [{
          object: 'block',
          type: 'to_do',
          to_do: {
            rich_text: [
              { type: 'text', text: { content: title } },
              { type: 'text', text: { content: ' ' } },
              { type: 'text', text: { content: priority }, annotations: { code: true } },
            ],
            checked: false,
            color,
          },
        }],
      }),
    },
  );
  if (!result.results[0]?.id) throw new Error('Notion에서 새 체크박스 ID를 받지 못했습니다.');
  return result.results[0].id;
}

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export async function startMicrosoftSignIn(clientId: string): Promise<DeviceCode> {
  return responseJson<DeviceCode>('https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: MICROSOFT_SCOPE }),
  });
}

export async function waitForMicrosoftSignIn(clientId: string, device: DeviceCode): Promise<TokenResponse> {
  const expiresAt = Date.now() + device.expires_in * 1000;
  let interval = Math.max(device.interval, 5) * 1000;
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const response = await fetch('https://login.microsoftonline.com/organizations/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: device.device_code,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as TokenResponse;
    if (response.ok && body.access_token) return body;
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(body.error_description ?? body.error ?? 'Microsoft 로그인에 실패했습니다.');
  }
  throw new Error('Microsoft 로그인 시간이 만료됐습니다.');
}

export async function refreshMicrosoftToken(clientId: string, refreshToken: string): Promise<TokenResponse> {
  return responseJson<TokenResponse>('https://login.microsoftonline.com/organizations/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      scope: MICROSOFT_SCOPE,
    }),
  });
}

interface GraphEvent {
  id: string;
  subject?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  responseStatus?: { response?: string };
}

function graphDate(value: { dateTime: string; timeZone: string }) {
  return value.timeZone === 'UTC' && !/[zZ]$|[+-]\d\d:\d\d$/.test(value.dateTime)
    ? `${value.dateTime}Z` : value.dateTime;
}

export async function fetchMicrosoftEvents(accessToken: string): Promise<CalendarEvent[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 32);
  const url = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
  url.searchParams.set('startDateTime', start.toISOString());
  url.searchParams.set('endDateTime', end.toISOString());
  url.searchParams.set('$top', '100');
  const events: CalendarEvent[] = [];
  let next: string | undefined = url.toString();
  while (next) {
    const data: { value: GraphEvent[]; '@odata.nextLink'?: string } = await responseJson(next, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    for (const event of data.value) {
      if (event.isCancelled) continue;
      events.push({
        id: `microsoft:${event.id}`,
        title: event.subject || '제목 없는 일정',
        startAt: graphDate(event.start),
        endAt: graphDate(event.end),
        source: 'microsoft',
        isAllDay: event.isAllDay ?? false,
        isCanceled: false,
        responseStatus: event.responseStatus?.response === 'declined' ? 'declined' : 'none',
      });
    }
    next = data['@odata.nextLink'];
  }
  return events;
}
