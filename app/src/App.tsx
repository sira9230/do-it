import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, MotionConfig, type PanInfo } from 'motion/react';
import { ArrowLeft, ChevronDown, ChevronUp, Clock3, ExternalLink, GripHorizontal, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox as UiCheckbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { AppState, CalendarEvent, Priority, Task } from './types';
import { formatReminderInput, parseReminderInput } from './reminder';

const priorityMeta: Record<Priority, { label: string; meaning: string }> = {
  P1: { label: '중요', meaning: '높음' },
  P2: { label: '보통', meaning: '기본' },
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
        && event.isMeeting !== false
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
  const format = (value: string) => {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  return `${format(event.startAt)} - ${format(event.endAt)}`;
}

function formatReminder(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function Bosongi() {
  return <div className="bosongi" aria-hidden="true"><img src="./assets/bosongi-face.png" alt="" /></div>;
}

function TaskCheckbox({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  return (
    <UiCheckbox
      className="interactive size-[18px]"
      checked={task.status === 'done'}
      aria-label={`${task.title} ${task.status === 'done' ? '완료 취소' : '완료'}`}
      onCheckedChange={() => onToggle(task.id)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return up ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />;
}

function PrioritySelector({ task, onChange }: { task: Task; onChange: (id: string, priority: Priority) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="priority-trigger interactive" aria-label={`${task.title} 중요도 변경`}>
        <Badge variant="secondary" className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="priority-menu">
        {(Object.keys(priorityMeta) as Priority[]).map((priority) => (
          <DropdownMenuItem key={priority} onClick={() => onChange(task.id, priority)}>
            <Badge variant="secondary" className={`priority ${priority.toLowerCase()}`}>{priorityMeta[priority].label}</Badge>
            <span>{priorityMeta[priority].meaning}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskRow({ task, onToggle, onPriority, onEdit, onDelete, onDragFinish }: { task: Task; onToggle: (id: string) => void; onPriority: (id: string, priority: Priority) => void; onEdit: (id: string) => void; onDelete?: (id: string) => void; onDragFinish?: () => void }) {
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  function finishDrag(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    onDragFinish?.();
    if (onDelete && Math.hypot(info.offset.x, info.offset.y) > 115) onDelete(task.id);
    setDragPoint(null);
  }
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 90, scale: .94, height: 0, marginTop: 0 }} transition={{ type: 'spring', stiffness: 390, damping: 34 }} className="task-slot">
      {dragPoint ? <div className="delete-placeholder"><Trash2 className="size-4" /><span>놓으면 삭제</span></div> : null}
      <motion.div drag={Boolean(onDelete)} dragSnapToOrigin dragMomentum={false} onDragStart={(_event, info) => setDragPoint(info.point)} onDrag={(_event, info) => setDragPoint(info.point)} onDragEnd={finishDrag} className={`task-row ${task.status === 'done' ? 'completed' : ''} ${dragPoint ? 'dragging-source' : ''}`}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <div>
        <div className="title-line">
          <PrioritySelector task={task} onChange={onPriority} />
          <strong>{task.title}</strong>
          <Button variant="ghost" size="icon-xs" className="edit-task" aria-label={`${task.title} 수정`} onClick={() => onEdit(task.id)}><Pencil className="size-3.5" /></Button>
        </div>
        {task.summary ? <p>{task.summary}</p> : null}
        {task.notionPageId ? <div className="task-source">
          <span>{task.sourcePageTitle ?? 'Notion 회의록'}</span>
          <Button variant="link" className="source-link" onClick={() => void window.doit.openNotionPage(task.notionPageId!)}>
            Notion <ExternalLink className="size-3" />
          </Button>
        </div> : null}
        {task.reminderAt && task.status !== 'done'
          ? <span className="reminder-badge"><Clock3 className="size-3" /> {formatReminder(task.reminderAt)} 리마인드</span>
          : null}
      </div>
      </motion.div>
      {dragPoint ? createPortal(<div className="drag-ghost" style={{ left: dragPoint.x - Math.min(320, window.innerWidth - 40) / 2, top: dragPoint.y - 30, width: Math.min(320, window.innerWidth - 40) }}><Badge variant="secondary" className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</Badge><strong>{task.title}</strong></div>, document.body) : null}
    </motion.div>
  );
}

function EditTask({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [summary, setSummary] = useState(task.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError('할 일을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      await window.doit.updateTask({ id: task.id, title, summary });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수정하지 못했어요.');
    } finally { setSaving(false); }
  }

  return <form className="page add" onSubmit={submit}>
    <div className="heading"><h2>할 일 수정</h2><Button type="button" variant="ghost" className="add-trigger" onClick={onClose}>취소</Button></div>
    <Label>할 일<Input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></Label>
    {task.notionBlockId ? <div className="edit-context"><strong>설명 · 상위 항목</strong><p>{task.summary || '상위 항목이 없어요.'}</p><small>상위 항목은 Notion 회의록에서 변경할 수 있어요.</small></div>
      : <Label>짧은 설명<Textarea maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="필요한 내용을 두세 줄로 적어주세요" /></Label>}
    {task.notionPageId ? <Button type="button" variant="link" className="edit-notion-link" onClick={() => void window.doit.openNotionPage(task.notionPageId!)}>Notion <ExternalLink className="size-3.5" /></Button> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
    <Button type="submit" className="primary" disabled={saving}>{saving ? '저장 중…' : '변경 사항 저장'}</Button>
  </form>;
}

function AddTask({ onClose, notionPages }: { onClose: () => void; notionPages: CalendarEvent[] }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [priority, setPriority] = useState<Priority>('P2');
  const [reminder, setReminder] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notionPageId, setNotionPageId] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError('할 일을 입력해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await window.doit.createTask({
        title,
        summary,
        priority,
        plannedDate: localDate(),
        reminderAt: parseReminderInput(reminder),
        notionPageId,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장하지 못했어요.');
    } finally { setSaving(false); }
  }

  return (
    <form className="page add" onSubmit={submit}>
      <div className="heading"><h2>할 일 추가</h2><Button type="button" variant="ghost" className="add-trigger" onClick={onClose}>취소</Button></div>
      <Label>할 일<Input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="무엇을 해볼까요?" /></Label>
      <Label>짧은 설명<Textarea maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="필요한 내용을 두세 줄로 적어주세요" /></Label>
      <fieldset>
        <legend>중요도</legend>
        <div className="options">
          {(Object.keys(priorityMeta) as Priority[]).map((value) => (
            <Button type="button" variant="outline" className={priority === value ? 'selected' : ''} onClick={() => setPriority(value)} key={value}>
              <strong>{priorityMeta[value].label}</strong><span>{priorityMeta[value].meaning}</span>
            </Button>
          ))}
        </div>
      </fieldset>
      {notionPages.length ? <fieldset>
        <legend>저장할 곳</legend>
        <div className="destination-options">
          <Button type="button" variant="outline" className={!notionPageId ? 'selected' : ''} onClick={() => setNotionPageId(null)}>앱에만 저장</Button>
          {notionPages.map((page) => <Button type="button" variant="outline" className={notionPageId === page.id.slice('notion:'.length) ? 'selected' : ''} onClick={() => setNotionPageId(page.id.slice('notion:'.length))} key={page.id}>{page.title}</Button>)}
        </div>
        <p className="destination-help">회의록을 선택하면 해당 페이지 맨 아래에 체크박스로 추가돼요.</p>
      </fieldset> : null}
      <Label>
        리마인드 <span className="optional">선택</span>
        <Input type="text" inputMode="numeric" className="reminder-input" placeholder="MM.DD 00:00" value={reminder} onChange={(event) => setReminder(formatReminderInput(event.target.value))} aria-label="리마인드 날짜와 시간" />
      </Label>
      <p className="form-help">설정한 시간에 macOS 알림으로 알려드려요.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <Button type="submit" className="primary" disabled={saving}>{saving ? '추가 중…' : '오늘 할 일로 추가'}</Button>
    </form>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="toggle"><strong>{label}</strong><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
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
      <div className="heading back"><Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="설정 닫기"><ArrowLeft className="size-4" /></Button><h2>설정</h2></div>
      <h3>위젯</h3>
      <Toggle label="항상 위에 표시" checked={state.settings.alwaysOnTop} onChange={(value) => update({ alwaysOnTop: value })} />
      <Toggle label="로그인할 때 자동 실행" checked={state.settings.launchAtLogin} onChange={(value) => update({ launchAtLogin: value })} />
      <Toggle label="내용 숨김" checked={state.settings.privacyMode} onChange={(value) => update({ privacyMode: value })} />
      <Toggle label="회의 30분 전 안내" checked={state.settings.meetingNoticeEnabled} onChange={(value) => update({ meetingNoticeEnabled: value })} />
      <Toggle label="할 일 푸시 리마인드" checked={state.settings.taskRemindersEnabled} onChange={(value) => update({ taskRemindersEnabled: value })} />
      <Button variant="secondary" className="position-reset" onClick={() => void window.doit.resetWindowPosition()}>상단 중앙으로 위치 초기화</Button>
      <p className="settings-note">위젯의 빈 공간이나 상단 헤더를 드래그해 원하는 곳으로 옮길 수 있어요.</p>
      <h3>연동 및 동기화 관리</h3>
      <div className="connection"><span><strong>Notion 회의록 DB</strong><small>{state.sync.notion === 'synced' ? '연결됨 · 회의 일정 표시' : state.sync.notion === 'error' ? '동기화 오류' : '연결 안 됨'}</small></span></div>
      <p className="settings-note">회의록 DB의 Name·날짜 속성과 오늘 페이지의 체크박스를 읽어요. <Button variant="link" className="help-link" onClick={() => void window.doit.openHelp('notion')}>연결 도움말 ↗</Button></p>
      <div className="connection-form"><Input type="password" value={notionToken} onChange={(event) => setNotionToken(event.target.value)} placeholder="Notion 액세스 토큰" aria-label="Notion 액세스 토큰" /><Button onClick={() => void connectNotion()} disabled={busy !== null || !notionToken.trim()}>연결</Button></div>
      {state.sync.notionError ? <p className="connection-error">{state.sync.notionError}</p> : null}
      <div className="connection"><span><strong>Microsoft Teams 캘린더</strong><small>{state.sync.microsoft === 'synced' ? '연결됨 · 계정 일정 표시' : state.sync.microsoft === 'error' ? '동기화 오류' : '연결 안 됨'}</small></span></div>
      <p className="settings-note">Teams와 같은 Microsoft 계정의 캘린더를 읽어요. 조직 권한이 필요할 수 있어요. <Button variant="link" className="help-link" onClick={() => void window.doit.openHelp('microsoft')}>앱 등록 방법 ↗</Button></p>
      <div className="connection-form"><Input value={microsoftClientId} onChange={(event) => setMicrosoftClientId(event.target.value)} placeholder="앱 클라이언트 ID" aria-label="Microsoft 앱 클라이언트 ID" /><Button onClick={() => void connectMicrosoft()} disabled={busy !== null || !microsoftClientId.trim()}>로그인</Button></div>
      {deviceCode ? <p className="device-code">열린 Microsoft 로그인 창에서 코드 <strong>{deviceCode}</strong>를 입력해주세요.</p> : null}
      {state.sync.microsoftError ? <p className="connection-error">{state.sync.microsoftError}</p> : null}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
      <Button variant="secondary" className="position-reset" onClick={() => void refresh()} disabled={busy !== null}>지금 동기화</Button>
      <div className="sync"><span>마지막 동기화</span><strong>{state.sync.lastSuccessAt ? new Date(state.sync.lastSuccessAt).toLocaleString('ko-KR') : '아직 없음'}</strong></div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [undoTask, setUndoTask] = useState<Task | null>(null);
  const [page, setPage] = useState<'home' | 'add' | 'edit' | 'settings'>('home');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [now, setNow] = useState(new Date());
  const lastDragAt = useRef(0);
  const previewDrag = useRef<{ screenX: number; screenY: number; windowX: number; windowY: number; moved: boolean } | null>(null);
  const suppressPreviewClick = useRef(false);

  useEffect(() => {
    window.doit.getState().then((next) => { setState(next); setLoaded(true); });
    const unsubscribe = window.doit.onStateChanged(setState);
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);

  const remaining = useMemo(() => state.tasks
    .filter((task) => task.status !== 'done' && task.plannedDate === localDate() && !deletingIds.includes(task.id))
    .toSorted((a, b) => a.priority.localeCompare(b.priority) || a.createdAt.localeCompare(b.createdAt)), [state.tasks, deletingIds]);
  const completed = useMemo(() => state.tasks.filter((task) => task.status === 'done' && !deletingIds.includes(task.id)), [state.tasks, deletingIds]);
  const meeting = state.settings.meetingNoticeEnabled ? meetingNotice(state.events, now) : null;
  const todayNotionPages = state.events.filter((event) => event.id.startsWith('notion:') && localDate(new Date(event.startAt)) === localDate(now));
  const todayEvents = state.events.filter((event) => !event.isCanceled && event.responseStatus !== 'declined'
    && !(event.id.startsWith('notion:') && event.isAllDay)
    && (localDate(new Date(event.startAt)) === localDate(now) || (new Date(event.startAt) < now && new Date(event.endAt) > now)));
  const editingTask = state.tasks.find((task) => task.id === editingTaskId) ?? null;

  useEffect(() => {
    void window.doit.setPreviewHovered(hovered && !expanded, remaining.length);
    void window.doit.showHoverCount(hovered && !expanded ? remaining.length : null);
    return () => { void window.doit.setPreviewHovered(false, 0); void window.doit.showHoverCount(null); };
  }, [hovered, expanded, remaining.length]);

  useEffect(() => {
    if (!undoTask) return;
    const timer = window.setTimeout(() => setUndoTask(null), 7000);
    return () => window.clearTimeout(timer);
  }, [undoTask]);

  async function deleteTask(id: string) {
    const task = state.tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    setDeletingIds((ids) => [...ids, id]);
    try {
      await window.doit.deleteTask(id);
      setUndoTask(task);
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : '할 일을 삭제하지 못했어요.');
    } finally {
      setDeletingIds((ids) => ids.filter((candidate) => candidate !== id));
    }
  }

  async function restoreTask() {
    if (!undoTask) return;
    const task = undoTask;
    setUndoTask(null);
    try { await window.doit.restoreTask(task); }
    catch (cause) { setUndoTask(task); window.alert(cause instanceof Error ? cause.message : '할 일을 되돌리지 못했어요.'); }
  }

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

  function handleSurfaceClick(event: React.MouseEvent<HTMLElement>) {
    if (!expanded || Date.now() - lastDragAt.current < 600) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button, input, textarea, select, a, [role="checkbox"], [role="menuitem"], [contenteditable="true"]')) return;
    collapse();
  }

  function startPreviewDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    suppressPreviewClick.current = false;
    previewDrag.current = { screenX: event.screenX, screenY: event.screenY, windowX: window.screenX, windowY: window.screenY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePreview(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = previewDrag.current;
    if (!drag) return;
    const dx = event.screenX - drag.screenX;
    const dy = event.screenY - drag.screenY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    suppressPreviewClick.current = true;
    void window.doit.moveWindow(Math.round(drag.windowX + dx), Math.round(drag.windowY + dy));
  }

  function finishPreviewDrag() { previewDrag.current = null; }

  function openFromPreview(event: React.MouseEvent<HTMLButtonElement>, next: 'home' | 'add' = 'home') {
    if (suppressPreviewClick.current) { suppressPreviewClick.current = false; event.preventDefault(); return; }
    open(next);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && expanded) collapse(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    return window.doit.onOutsideClick(() => collapse());
  }, [expanded]);

  const toggle = (id: string) => void window.doit.toggleTask(id);
  const changePriority = (id: string, priority: Priority) => void window.doit.setTaskPriority(id, priority);
  const editTask = (id: string) => { setEditingTaskId(id); setPage('edit'); };
  if (!loaded) return <main className="shell loading"><Bosongi /><span>두잇 준비 중…</span></main>;

  return <MotionConfig reducedMotion="user">
    <main className={`shell ${expanded ? 'expanded' : 'collapsed'} ${hovered && !expanded ? 'preview-open' : ''}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={handleSurfaceClick}>
      <button type="button" className="widget-close floating-close interactive" aria-label="Do it 종료" title="앱 종료" onClick={(event) => { event.stopPropagation(); void window.doit.quitApp(); }}><X className="size-3.5" /></button>
      {!expanded ? (
        <motion.div className="collapsed-inner" title="빈 공간을 드래그해 위젯을 옮길 수 있어요" initial={{ opacity: 0, scale: .84 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 270, damping: 27 }}>
          <AnimatePresence initial={false}>
            {remaining.slice(0, hovered ? 3 : 1).map((task, index) => <motion.button type="button" key={task.id} className={`preview-card interactive ${index === 0 ? 'current' : 'next'}`} initial={{ y: 0, scale: .7, opacity: 0, filter: 'blur(3px)' }} animate={{ y: [0, 37, 69][index], scale: index === 0 ? 1 : index === 1 ? .78 : .72, opacity: 1 - index * .16, filter: 'blur(0px)' }} exit={{ y: -38, scale: .7, opacity: 0, filter: 'blur(2px)' }} transition={{ type: 'spring', stiffness: 420, damping: 29, delay: index * .045 }} style={{ zIndex: 3 - index }} onPointerDown={startPreviewDrag} onPointerMove={movePreview} onPointerUp={finishPreviewDrag} onPointerCancel={finishPreviewDrag} onClick={(event) => openFromPreview(event)} aria-label={`${task.title} · 할 일 목록 열기`}>
              {index === 0 ? <Bosongi /> : null}
              <div className="preview-content">
                {index === 0 && meeting ? <div className="preview-meeting"><span>{formatTimeRange(meeting)}</span><strong>{state.settings.privacyMode ? '회의 예정' : meeting.title}</strong></div> : null}
                <div className="preview-task"><Badge variant="secondary" className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</Badge><strong>{state.settings.privacyMode ? '할 일' : task.title}</strong></div>
              </div>
              {index === 0 ? <Chevron /> : null}
            </motion.button>)}
          </AnimatePresence>
          {!remaining.length ? <button type="button" className="preview-card current preview-empty interactive" onPointerDown={startPreviewDrag} onPointerMove={movePreview} onPointerUp={finishPreviewDrag} onPointerCancel={finishPreviewDrag} onClick={(event) => openFromPreview(event, 'add')}><Bosongi /><span>오늘 할 일을 추가해볼까요?</span><Chevron /></button> : null}
        </motion.div>
      ) : (
        <motion.div className="expanded-inner" initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 270, damping: 24, mass: .9 }}>
          <header>
            <div className="header-leading"><Button variant="ghost" className="brand interactive" onClick={collapse}><Bosongi /><span>Do it</span></Button></div>
            <div><div className="window-grip" title="위젯 위치 이동" aria-label="위젯 위치 이동"><GripHorizontal className="size-4" /></div><Button variant="ghost" size="icon" className="icon interactive" aria-label="설정" onClick={() => setPage('settings')}><Settings2 className="size-4" /></Button><Button variant="ghost" size="icon" className="icon interactive" aria-label="접기" onClick={collapse}><Chevron up /></Button></div>
          </header>
          {page === 'add' ? <AddTask onClose={() => setPage('home')} notionPages={todayNotionPages} /> : page === 'edit' && editingTask ? <EditTask key={editingTask.id} task={editingTask} onClose={() => setPage('home')} /> : page === 'settings' ? <SettingsPage state={state} onBack={() => setPage('home')} /> : (
            <section className="page home">
              <div className="timeline"><h2>오늘 일정</h2>{todayEvents.length ? <div className="timeline-cards" role="list">{todayEvents.map((event) => <div className="timeline-card" role="listitem" key={event.id}><time>{formatTimeRange(event)}</time><strong>{state.settings.privacyMode ? '회의 일정' : event.title}</strong></div>)}</div> : <p>오늘 일정이 없어요.</p>}</div>
              {meeting ? <div className="meeting-card"><span>{new Date(meeting.startAt) <= now ? '회의 중' : '곧 시작하는 회의'}</span><strong>{formatTimeRange(meeting)} · {state.settings.privacyMode ? '회의 예정' : meeting.title}</strong></div> : null}
              <div className="heading"><h1>남은 할 일 <span className="task-count">{remaining.length}개</span></h1><Button variant="ghost" className="add-trigger" onClick={() => setPage('add')}><Plus className="size-4" /> 추가</Button></div>
              <div className="list"><AnimatePresence initial={false}>{remaining.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} onPriority={changePriority} onEdit={editTask} onDelete={deleteTask} onDragFinish={() => { lastDragAt.current = Date.now(); }} />)}</AnimatePresence></div>
              {!remaining.length ? <div className="all-done"><Bosongi /><strong>{state.tasks.length ? '오늘 할 일을 모두 마쳤어요' : '오늘 할 일이 아직 없어요'}</strong><Button variant="secondary" onClick={() => setPage('add')}>할 일 추가하기</Button></div> : null}
              {completed.length ? <div className="completed-list"><Button variant="ghost" onClick={() => setShowCompleted((value) => !value)}>완료한 일 {completed.length}개 <Chevron up={showCompleted} /></Button><AnimatePresence initial={false}>{showCompleted ? completed.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} onPriority={changePriority} onEdit={editTask} onDelete={deleteTask} />) : null}</AnimatePresence></div> : null}
              <AnimatePresence>{undoTask ? <motion.div className="undo-toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} role="status"><span>할 일을 삭제했어요</span><Button variant="secondary" className="undo-action" onClick={() => void restoreTask()}>되돌리기</Button></motion.div> : null}</AnimatePresence>
            </section>
          )}
        </motion.div>
      )}
    </main>
  </MotionConfig>;
}
