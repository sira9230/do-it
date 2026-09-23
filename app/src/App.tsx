import { useEffect, useMemo, useState } from 'react';
import type { AppState, CalendarEvent, Priority, Task } from './types';

const priorityMeta: Record<Priority, { label: string; meaning: string }> = {
  P1: { label: '개중요', meaning: '높음' },
  P2: { label: '챙겨두자', meaning: '보통' },
  P3: { label: '천처니', meaning: '낮음' },
};

const emptyState: AppState = {
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

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function localDateTimeInput(date: Date) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${localDate(date)}T${hours}:${minutes}`;
}

function meetingNotice(events: CalendarEvent[], now: Date) {
  return events
    .filter((event) => {
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);
      const startsToday = localDate(start) === localDate(now);
      const startedBeforeToday = start < new Date(`${localDate(now)}T00:00:00`);
      const crossesMidnight = startedBeforeToday && now >= start && now < end;
      return !event.isCanceled
        && !event.isAllDay
        && event.responseStatus !== 'declined'
        && ((startsToday && now >= new Date(start.getTime() - 30 * 60_000) && now < end) || crossesMidnight);
    })
    .toSorted((a, b) => {
      const aStarted = new Date(a.startAt) <= now ? 0 : 1;
      const bStarted = new Date(b.startAt) <= now ? 0 : 1;
      return aStarted - bStarted || a.startAt.localeCompare(b.startAt);
    })[0] ?? null;
}

function formatTimeRange(event: CalendarEvent) {
  if (event.isAllDay) return '종일';
  const formatter = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${formatter.format(new Date(event.startAt))}–${formatter.format(new Date(event.endAt))}`;
}

function formatReminder(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function Bosongi() {
  return <div className="bosongi" aria-hidden="true"><img src="./assets/bosongi-face.png" alt="" /></div>;
}

function Checkbox({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`check ${task.status === 'done' ? 'done' : ''}`}
      aria-label={`${task.title} ${task.status === 'done' ? '완료 취소' : '완료'}`}
      aria-pressed={task.status === 'done'}
      onClick={(event) => { event.stopPropagation(); onToggle(task.id); }}
    >
      {task.status === 'done' ? '✓' : ''}
    </button>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return <span className={`chevron ${up ? 'up' : ''}`} aria-hidden="true">⌄</span>;
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  return (
    <div className={`task-row ${task.status === 'done' ? 'completed' : ''}`}>
      <Checkbox task={task} onToggle={onToggle} />
      <div>
        <div className="title-line">
          <span className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</span>
          <strong>{task.title}</strong>
        </div>
        {task.summary ? <p>{task.summary}</p> : null}
        {task.reminderAt && task.status !== 'done'
          ? <span className="reminder-badge">◷ {formatReminder(task.reminderAt)} 리마인드</span>
          : null}
      </div>
    </div>
  );
}

function AddTask({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [priority, setPriority] = useState<Priority>('P2');
  const [reminder, setReminder] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('할 일을 입력해주세요.');
      return;
    }
    try {
      await window.doit.createTask({
        title,
        summary,
        priority,
        plannedDate: localDate(),
        reminderAt: reminder ? new Date(reminder).toISOString() : null,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장하지 못했어요.');
    }
  }

  return (
    <form className="page add" onSubmit={submit}>
      <div className="heading"><h2>할 일 추가</h2><button type="button" className="text" onClick={onClose}>취소</button></div>
      <label>할 일<input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="무엇을 해볼까요?" /></label>
      <label>짧은 설명<textarea maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="필요한 내용을 두세 줄로 적어주세요" /></label>
      <fieldset>
        <legend>중요도</legend>
        <div className="options">
          {(Object.keys(priorityMeta) as Priority[]).map((value) => (
            <button type="button" className={priority === value ? 'selected' : ''} onClick={() => setPriority(value)} key={value}>
              <strong>{priorityMeta[value].label}</strong><span>{priorityMeta[value].meaning}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        리마인드 <span className="optional">선택</span>
        <input type="datetime-local" min={localDateTimeInput(new Date(Date.now() + 60_000))} value={reminder} onChange={(event) => setReminder(event.target.value)} />
      </label>
      <p className="form-help">설정한 시간에 macOS 알림으로 알려드려요.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="primary">오늘 할 일로 추가</button>
    </form>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle"><strong>{label}</strong><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function SettingsPage({ state, onBack }: { state: AppState; onBack: () => void }) {
  const update = (patch: Partial<AppState['settings']>) => void window.doit.updateSettings(patch);
  const [notionToken, setNotionToken] = useState('');
  const [microsoftClientId, setMicrosoftClientId] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [busy, setBusy] = useState<'notion' | 'microsoft' | 'sync' | null>(null);
  const [error, setError] = useState('');
  async function connectNotion() {
    setBusy('notion'); setError('');
    try {
      await window.doit.connectNotion(notionToken);
      setNotionToken('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Notion 연결에 실패했어요.'); }
    finally { setBusy(null); }
  }
  async function connectMicrosoft() {
    setBusy('microsoft'); setError('');
    try {
      const device = await window.doit.connectMicrosoft(microsoftClientId);
      setDeviceCode(device.userCode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Microsoft 연결에 실패했어요.'); }
    finally { setBusy(null); }
  }
  async function refresh() {
    setBusy('sync'); setError('');
    try { await window.doit.refreshSync(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '동기화에 실패했어요.'); }
    finally { setBusy(null); }
  }
  return (
    <section className="page settings">
      <div className="heading back"><button onClick={onBack} aria-label="설정 닫기">‹</button><h2>설정</h2></div>
      <h3>위젯</h3>
      <Toggle label="항상 위에 표시" checked={state.settings.alwaysOnTop} onChange={(value) => update({ alwaysOnTop: value })} />
      <Toggle label="로그인할 때 자동 실행" checked={state.settings.launchAtLogin} onChange={(value) => update({ launchAtLogin: value })} />
      <Toggle label="내용 숨김" checked={state.settings.privacyMode} onChange={(value) => update({ privacyMode: value })} />
      <Toggle label="회의 30분 전 안내" checked={state.settings.meetingNoticeEnabled} onChange={(value) => update({ meetingNoticeEnabled: value })} />
      <Toggle label="할 일 푸시 리마인드" checked={state.settings.taskRemindersEnabled} onChange={(value) => update({ taskRemindersEnabled: value })} />
      <button className="position-reset" onClick={() => void window.doit.resetWindowPosition()}>상단 중앙으로 위치 초기화</button>
      <p className="settings-note">위젯의 빈 공간이나 상단 헤더를 드래그해 원하는 곳으로 옮길 수 있어요.</p>
      <h3>연동 및 동기화 관리</h3>
      <div className="connection"><span><strong>Notion 회의록 DB</strong><small>{state.sync.notion === 'synced' ? '연결됨 · 회의 일정 표시' : state.sync.notion === 'error' ? '동기화 오류' : '연결 안 됨'}</small></span></div>
      <p className="settings-note">회의록 DB의 Name·날짜 속성을 읽어요. 개인 액세스 토큰을 만들거나, 내부 통합을 만든 뒤 이 DB를 공유해주세요. <button className="help-link" onClick={() => void window.doit.openHelp('notion')}>토큰 발급 방법 ↗</button></p>
      <div className="connection-form"><input type="password" value={notionToken} onChange={(event) => setNotionToken(event.target.value)} placeholder="Notion 액세스 토큰" aria-label="Notion 액세스 토큰" /><button onClick={() => void connectNotion()} disabled={busy !== null || !notionToken.trim()}>연결</button></div>
      {state.sync.notionError ? <p className="connection-error">{state.sync.notionError}</p> : null}
      <div className="connection"><span><strong>Microsoft Teams 캘린더</strong><small>{state.sync.microsoft === 'synced' ? '연결됨 · 계정 일정 표시' : state.sync.microsoft === 'error' ? '동기화 오류' : '연결 안 됨'}</small></span></div>
      <p className="settings-note">Teams와 같은 Microsoft 계정의 캘린더를 읽어요. Entra 앱 등록에서 공개 클라이언트 흐름과 Calendars.Read 권한이 필요해요. <button className="help-link" onClick={() => void window.doit.openHelp('microsoft')}>앱 등록 방법 ↗</button></p>
      <div className="connection-form"><input value={microsoftClientId} onChange={(event) => setMicrosoftClientId(event.target.value)} placeholder="앱 클라이언트 ID" aria-label="Microsoft 앱 클라이언트 ID" /><button onClick={() => void connectMicrosoft()} disabled={busy !== null || !microsoftClientId.trim()}>로그인</button></div>
      {deviceCode ? <p className="device-code">열린 Microsoft 로그인 창에서 코드 <strong>{deviceCode}</strong>를 입력해주세요.</p> : null}
      {state.sync.microsoftError ? <p className="connection-error">{state.sync.microsoftError}</p> : null}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
      <button className="position-reset" onClick={() => void refresh()} disabled={busy !== null}>지금 동기화</button>
      <div className="sync"><span>마지막 동기화</span><strong>{state.sync.lastSuccessAt ? new Date(state.sync.lastSuccessAt).toLocaleString('ko-KR') : '아직 없음'}</strong></div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [page, setPage] = useState<'home' | 'add' | 'settings'>('home');
  const [showCompleted, setShowCompleted] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    window.doit.getState().then((next) => { setState(next); setLoaded(true); });
    const unsubscribe = window.doit.onStateChanged(setState);
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);

  const remaining = useMemo(() => state.tasks
    .filter((task) => task.status !== 'done' && task.plannedDate === localDate())
    .toSorted((a, b) => a.priority.localeCompare(b.priority) || a.createdAt.localeCompare(b.createdAt)), [state.tasks]);
  const completed = useMemo(() => state.tasks.filter((task) => task.status === 'done'), [state.tasks]);
  const meeting = state.settings.meetingNoticeEnabled ? meetingNotice(state.events, now) : null;
  const todayEvents = state.events.filter((event) => !event.isCanceled && event.responseStatus !== 'declined'
    && (localDate(new Date(event.startAt)) === localDate(now) || (new Date(event.startAt) < now && new Date(event.endAt) > now)));
  const representative = remaining[0] ?? null;

  function open(next: 'home' | 'add' | 'settings' = 'home') {
    setPage(next);
    setExpanded(true);
    void window.doit.setExpanded(true);
  }

  function collapse() {
    setPage('home');
    setExpanded(false);
    void window.doit.setExpanded(false);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && expanded) collapse(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  const toggle = (id: string) => void window.doit.toggleTask(id);
  if (!loaded) return <main className="shell loading"><Bosongi /><span>두잇 준비 중…</span></main>;

  return (
    <main className={`shell ${expanded ? 'expanded' : 'collapsed'}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {!expanded ? (
        <div className="collapsed-inner" title="빈 공간을 드래그해 위젯을 옮길 수 있어요">
          <button className="open-character interactive" aria-label="할 일 펼치기" onClick={() => open()}><Bosongi /></button>
          <div className="collapsed-copy">
            {meeting ? <div className="meeting"><span>{formatTimeRange(meeting)}</span><strong>{state.settings.privacyMode ? '회의 예정' : meeting.title}</strong></div> : null}
            {representative ? (
              <div className="hero"><Checkbox task={representative} onToggle={toggle} /><span className={`priority ${representative.priority.toLowerCase()}`}>{priorityMeta[representative.priority].label}</span><strong>{state.settings.privacyMode ? '할 일' : representative.title}</strong></div>
            ) : <button className="empty interactive" onClick={() => open('add')}>오늘 할 일을 추가해볼까요?</button>}
            <div className={`count ${hovered ? 'visible' : ''}`}>오늘 남은 할 일 {remaining.length}개</div>
          </div>
          <button className="icon interactive" aria-label="전체 할 일 보기" onClick={() => open()}><Chevron /></button>
        </div>
      ) : (
        <div className="expanded-inner">
          <header>
            <button className="brand interactive" onClick={() => setPage('home')}><Bosongi /><span>Do it</span></button>
            <div><button className="icon interactive" aria-label="설정" onClick={() => setPage('settings')}>⚙</button><button className="icon interactive" aria-label="접기" onClick={collapse}><Chevron up /></button></div>
          </header>
          {page === 'add' ? <AddTask onClose={() => setPage('home')} /> : page === 'settings' ? <SettingsPage state={state} onBack={() => setPage('home')} /> : (
            <section className="page home">
              {meeting ? <div className="meeting-card"><span>{new Date(meeting.startAt) <= now ? '회의 중' : '30분 뒤 회의'}</span><strong>{formatTimeRange(meeting)} · {state.settings.privacyMode ? '회의 예정' : meeting.title}</strong></div> : null}
              <div className="heading"><div><span className="eyebrow">TODAY</span><h1>남은 할 일 {remaining.length}개</h1></div><button className="text" onClick={() => setPage('add')}>＋ 추가</button></div>
              <div className="list">{remaining.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} />)}</div>
              {!remaining.length ? <div className="all-done"><Bosongi /><strong>{state.tasks.length ? '오늘 할 일을 모두 마쳤어요' : '오늘 할 일이 아직 없어요'}</strong><button onClick={() => setPage('add')}>할 일 추가하기</button></div> : null}
              {completed.length ? <div className="completed-list"><button onClick={() => setShowCompleted((value) => !value)}>완료한 일 {completed.length}개 <Chevron up={showCompleted} /></button>{showCompleted ? completed.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} />) : null}</div> : null}
              <div className="timeline"><h2>오늘 타임라인</h2>{todayEvents.length ? todayEvents.map((event) => <div key={event.id}><time>{formatTimeRange(event)}</time><strong>{state.settings.privacyMode ? '회의 일정' : event.title}</strong></div>) : <p>오늘 일정이 없어요.</p>}</div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
