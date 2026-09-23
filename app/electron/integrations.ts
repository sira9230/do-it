import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CalendarEvent } from './types.js';

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
  properties: {
    Name?: { title?: { plain_text?: string }[] };
    날짜?: { date?: { start: string; end?: string | null } | null };
  };
}

export async function fetchNotionEvents(token: string): Promise<CalendarEvent[]> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
  const events: CalendarEvent[] = [];
  let cursor: string | undefined;
  do {
    const data = await responseJson<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(
      `https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE}/query`,
      { method: 'POST', headers, body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) },
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
      });
    }
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return events;
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
