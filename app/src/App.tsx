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
import { moveTaskId } from './task-order';
import { completedForDate, localCompletedHistory } from './task-views';

const priorityMeta: Record<Priority, { label: string; meaning: string }> = {
  P1: { label: '중요', meaning: '높음' },
  P2: { label: '보통', meaning: '기본' },
  P3: { label: '천처니', meaning: '낮음' },
};
const draftWarning = '작성 중인 할 일이 있어요. 저장하거나 내용을 지운 뒤 이동해 주세요.';

const emptyState: AppState = {
  tasks: [],
  taskOrder: [],
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

function Bosongi({ animated = false }: { animated?: boolean }) {
  return <div className={`bosongi ${animated ? 'bosongi-animated' : ''}`} aria-hidden="true"><img src="./assets/bosongi-face.png" alt="" />{animated ? <img className="bosongi-blink" src="./assets/bosongi-face-blink.png" alt="" /> : null}</div>;
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

function TaskRow({ task, onToggle, onPriority, onEdit, onDelete, onDragStart, onDragMove, onReorder, onDragFinish }: { task: Task; onToggle: (id: string) => void; onPriority: (id: string, priority: Priority) => void; onEdit: (id: string) => void; onDelete?: (id: string) => void; onDragStart?: (id: string) => void; onDragMove?: (id: string, pointerY: number, offsetX: number, offsetY: number) => void; onReorder?: (id: string, pointerY: number) => void; onDragFinish?: () => void }) {
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [dragIntent, setDragIntent] = useState<'delete' | 'reorder'>('reorder');
  const [settling, setSettling] = useState(false);
  function finishDrag(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    onDragFinish?.();
    if (onDelete && Math.abs(info.offset.x) > 115 && Math.abs(info.offset.x) > Math.abs(info.offset.y) * 1.15) onDelete(task.id);
    else onReorder?.(task.id, info.point.y);
    setDragPoint(null);
  }
  return (
    <motion.div initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 90, scale: .94, height: 0, marginTop: 0 }} transition={{ type: 'spring', stiffness: 310, damping: 28 }} className="task-slot" data-task-id={task.id}>
      {dragPoint ? <div className={`delete-placeholder ${dragIntent === 'reorder' ? 'reorder-placeholder' : ''}`}>{dragIntent === 'delete' ? <Trash2 className="size-4" /> : <GripHorizontal className="size-4" />}<span>{dragIntent === 'delete' ? '놓으면 삭제' : '위아래로 옮겨 순서 변경'}</span></div> : null}
      <motion.div drag={Boolean(onDelete)} dragSnapToOrigin dragMomentum={false} onClick={(event) => event.stopPropagation()} onDragStart={(_event, info) => { setSettling(true); setDragPoint(info.point); onDragStart?.(task.id); }} onDrag={(_event, info) => { setDragPoint(info.point); setDragIntent(Math.abs(info.offset.x) > Math.abs(info.offset.y) * 1.15 && Math.abs(info.offset.x) > 24 ? 'delete' : 'reorder'); onDragMove?.(task.id, info.point.y, info.offset.x, info.offset.y); }} onDragEnd={finishDrag} className={`task-row ${task.status === 'done' ? 'completed' : ''} ${dragPoint || settling ? 'dragging-source' : ''}`}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <div>
        <div className="title-line">
          <PrioritySelector task={task} onChange={onPriority} />
          <strong>{task.title}</strong>
          <Button variant="ghost" size="icon-xs" className="edit-task" aria-label={`${task.title} 수정`} onClick={() => onEdit(task.id)}><Pencil className="size-3.5" /></Button>
        </div>
        {task.status !== 'todo' ? <span className={`notion-status ${task.status === 'done' ? 'done' : 'in-progress'}`}>{task.status === 'done' ? '완료' : '진행중'}</span> : null}
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
      {createPortal(<AnimatePresence onExitComplete={() => setSettling(false)}>{dragPoint ? <motion.div key="drag-preview" className="drag-ghost" initial={{ scale: 1, opacity: 1 }} animate={{ scale: .96, opacity: 1 }} exit={{ scale: 1, opacity: 0 }} transition={{ duration: .16, ease: 'easeOut' }} style={{ left: dragPoint.x - Math.min(320, window.innerWidth - 40) / 2, top: dragPoint.y - 30, width: Math.min(320, window.innerWidth - 40) }}><Badge variant="secondary" className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</Badge><strong>{task.title}</strong></motion.div> : null}</AnimatePresence>, document.body)}
    </motion.div>
  );
}

function EditTask({ task, onClose, onSaved, onDirtyChange, notionPages }: { task: Task; onClose: () => void; onSaved: () => void; onDirtyChange: (dirty: boolean) => void; notionPages: CalendarEvent[] }) {
  const [title, setTitle] = useState(task.title);
  const [summary, setSummary] = useState(task.summary);
  const [notionPageId, setNotionPageId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onDirtyChange(title !== task.title || summary !== task.summary || Boolean(notionPageId)), [title, summary, notionPageId, task.title, task.summary, onDirtyChange]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError('할 일을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      await window.doit.updateTask({ id: task.id, title, summary, notionPageId });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수정하지 못했어요.');
    } finally { setSaving(false); }
  }

  return <form className="page add" onSubmit={submit}>
    <div className="heading"><h2>할 일 수정</h2><Button type="button" variant="ghost" className="add-trigger" onClick={onClose}>취소</Button></div>
    <Label>할 일<Input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></Label>
    {task.notionBlockId ? <div className="edit-context"><strong>설명 · 상위 항목</strong><p>{task.summary || '상위 항목이 없어요.'}</p><small>상위 항목은 Notion 회의록에서 변경할 수 있어요.</small></div>
      : <Label>짧은 설명<Textarea maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="필요한 내용을 두세 줄로 적어주세요" /></Label>}
    {!task.notionBlockId && notionPages.length ? <fieldset>
      <legend>저장할 곳</legend>
      <div className="destination-options">
        <Button type="button" variant="outline" className={!notionPageId ? 'selected' : ''} onClick={() => setNotionPageId(null)}>앱에만 저장</Button>
        {notionPages.map((page) => <Button type="button" variant="outline" className={notionPageId === page.id.slice('notion:'.length) ? 'selected' : ''} onClick={() => setNotionPageId(page.id.slice('notion:'.length))} key={page.id}>{page.title}</Button>)}
      </div>
      <p className="destination-help">회의록 맨 위에 체크박스로 추가되고, 짧은 설명은 그 아래에 표시돼요.</p>
    </fieldset> : null}
    {task.notionPageId ? <Button type="button" variant="link" className="edit-notion-link" onClick={() => void window.doit.openNotionPage(task.notionPageId!)}>Notion <ExternalLink className="size-3.5" /></Button> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
    <Button type="submit" className="primary" disabled={saving}>{saving ? '저장 중…' : '변경 사항 저장'}</Button>
  </form>;
}

function AddTask({ onClose, onSaved, onDirtyChange, notionPages }: { onClose: () => void; onSaved: () => void; onDirtyChange: (dirty: boolean) => void; notionPages: CalendarEvent[] }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [priority, setPriority] = useState<Priority>('P2');
  const [status, setStatus] = useState<'todo' | 'in_progress'>('todo');
  const [reminder, setReminder] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notionPageId, setNotionPageId] = useState<string | null>(null);

  useEffect(() => onDirtyChange(Boolean(title.trim() || summary.trim() || reminder || priority !== 'P2' || status !== 'todo' || notionPageId)), [title, summary, reminder, priority, status, notionPageId, onDirtyChange]);

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
        status,
        plannedDate: localDate(),
        reminderAt: parseReminderInput(reminder),
        notionPageId,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장하지 못했어요.');
    } finally { setSaving(false); }
  }

  return (
    <form className="page add" onSubmit={submit}>
      <div className="heading"><h2>할 일 추가</h2><Button type="button" variant="ghost" className="add-trigger" onClick={onClose}>취소</Button></div>
      <Label>할 일 <span className="required">필수</span><Input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="무엇을 해볼까요?" /></Label>
      <Label>짧은 설명 <span className="optional">선택</span><Textarea maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="필요한 내용을 두세 줄로 적어주세요" /></Label>
      <fieldset>
        <legend>중요도 <span className="required">필수</span></legend>
        <div className="options">
          {(Object.keys(priorityMeta) as Priority[]).map((value) => (
            <Button type="button" variant="outline" aria-pressed={priority === value} className={`priority-option ${value.toLowerCase()} ${priority === value ? 'selected' : ''}`} onClick={() => setPriority(value)} key={value}>
              <strong>{priorityMeta[value].label}</strong><span>{priorityMeta[value].meaning}</span>
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>진행 상태 <span className="required">필수</span></legend>
        <div className="status-options">
          <Button type="button" variant="outline" aria-pressed={status === 'todo'} className={status === 'todo' ? 'selected' : ''} onClick={() => setStatus('todo')}>할 예정</Button>
          <Button type="button" variant="outline" aria-pressed={status === 'in_progress'} className={status === 'in_progress' ? 'selected' : ''} onClick={() => setStatus('in_progress')}>진행중</Button>
        </div>
      </fieldset>
      <fieldset>
        <legend>저장할 곳 <span className="required">필수</span></legend>
        <div className="destination-options">
          <Button type="button" variant="outline" aria-pressed={!notionPageId} className={!notionPageId ? 'selected' : ''} onClick={() => setNotionPageId(null)}>앱에만 저장</Button>
          {notionPages.map((page) => <Button type="button" variant="outline" aria-pressed={notionPageId === page.id.slice('notion:'.length)} className={notionPageId === page.id.slice('notion:'.length) ? 'selected' : ''} onClick={() => setNotionPageId(page.id.slice('notion:'.length))} key={page.id}>{page.title}</Button>)}
        </div>
        {notionPages.length ? <p className="destination-help">회의록 맨 위에 체크박스로 추가되고, 짧은 설명은 그 아래에 표시돼요.</p> : null}
      </fieldset>
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
  const [appVersion, setAppVersion] = useState('…');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);
  const [archivePageId, setArchivePageId] = useState('');
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [archiveMessage, setArchiveMessage] = useState('');
  const localCompleted = localCompletedHistory(state.tasks);
  const notionPages = state.events.filter((event) => event.id.startsWith('notion:')).toSorted((a, b) => a.startAt.localeCompare(b.startAt));
  useEffect(() => { void window.doit.getAppVersion().then(setAppVersion); }, []);
  async function checkUpdate() {
    setCheckingUpdate(true); setUpdateMessage('');
    try {
      const result = await window.doit.checkForUpdates();
      setUpdateMessage(result.updateAvailable ? `v${result.latestVersion} 설치 파일을 열었어요. 다운로드 후 설치하고 앱을 다시 실행해주세요.` : '최신 버전이에요.');
    } catch (cause) { setUpdateMessage(cause instanceof Error ? cause.message : '업데이트 확인에 실패했어요.'); }
    finally { setCheckingUpdate(false); }
  }
  async function addArchiveToNotion(task: Task) {
    if (!archivePageId) { setArchiveMessage('추가할 Notion 회의록을 선택해주세요.'); return; }
    setArchiveBusyId(task.id); setArchiveMessage('');
    try {
      await window.doit.updateTask({ id: task.id, title: task.title, summary: task.summary, notionPageId: archivePageId });
      setExpandedArchiveId(null);
      setArchivePageId('');
      setArchiveMessage('완료한 할 일을 Notion 회의록에 추가했어요.');
    } catch (cause) { setArchiveMessage(cause instanceof Error ? cause.message : 'Notion에 추가하지 못했어요.'); }
    finally { setArchiveBusyId(null); }
  }
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
      <h3>완료 기록 <span className="archive-count">{localCompleted.length}개</span></h3>
      <p className="settings-note">앱에만 저장된 완료 항목이에요.</p>
      {localCompleted.length ? <div className="local-archive">{localCompleted.map((task) => <div className="archive-task" key={task.id}>
        <button type="button" className="archive-task-toggle" aria-expanded={expandedArchiveId === task.id} onClick={() => { setExpandedArchiveId(expandedArchiveId === task.id ? null : task.id); setArchivePageId(''); setArchiveMessage(''); }}>
          <span className="archive-task-title"><Badge variant="secondary" className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</Badge><strong>{task.title}</strong><Chevron up={expandedArchiveId === task.id} /></span>
          <time dateTime={task.createdAt}>앱에 추가한 날짜 · {new Date(task.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}</time>
        </button>
        <Button variant="ghost" size="xs" className="archive-notion-trigger" onClick={() => { setExpandedArchiveId(task.id); setArchivePageId(''); setArchiveMessage(''); }}>Notion에 추가하기</Button>
        {expandedArchiveId === task.id ? <div className="archive-task-details">
          {task.summary ? <p>{task.summary}</p> : null}
          {notionPages.length ? <div className="archive-transfer">
            <label htmlFor={`archive-page-${task.id}`}>추가할 Notion 회의록</label>
            <select id={`archive-page-${task.id}`} value={archivePageId} onChange={(event) => setArchivePageId(event.target.value)}><option value="">회의록 선택</option>{notionPages.map((page) => <option key={page.id} value={page.id.slice('notion:'.length)}>{new Date(page.startAt).toLocaleDateString('ko-KR')} · {page.title}</option>)}</select>
            <Button size="sm" onClick={() => void addArchiveToNotion(task)} disabled={archiveBusyId !== null || !archivePageId}>{archiveBusyId === task.id ? '추가 중…' : '선택한 회의록에 추가'}</Button>
          </div> : <p className="settings-note">연결된 Notion 회의록이 없어요. 먼저 Notion을 연결하거나 동기화해주세요.</p>}
        </div> : null}
      </div>)}</div> : <p className="settings-note">앱에만 저장하고 완료한 할 일이 아직 없어요.</p>}
      {archiveMessage ? <p className="settings-note" role="status">{archiveMessage}</p> : null}
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
      <h3>앱 정보</h3>
      <div className="app-update"><span><strong>Do it</strong><small>버전 {appVersion}</small></span><Button variant="secondary" size="xs" onClick={() => void checkUpdate()} disabled={checkingUpdate}>{checkingUpdate ? '확인 중…' : '업데이트 확인'}</Button></div>
      {updateMessage ? <p className="settings-note" role="status">{updateMessage}</p> : null}
    </section>
  );
}

export function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [undoTask, setUndoTask] = useState<Task | null>(null);
  const [page, setPage] = useState<'home' | 'add' | 'edit' | 'settings'>('home');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [now, setNow] = useState(new Date());
  const today = localDate(now);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  const dragPositionRef = useRef<{ id: string; y: number; xOffset: number; yOffset: number } | null>(null);
  const lastDragAt = useRef(0);
  const taskDragging = useRef(false);
  const previewDrag = useRef<{ source: EventTarget; screenX: number; screenY: number; windowX: number; windowY: number; moved: boolean } | null>(null);
  const suppressPreviewClick = useRef(false);
  const collapsingRef = useRef(false);

  useEffect(() => {
    window.doit.getState().then((next) => { setState(next); setLoaded(true); });
    const unsubscribe = window.doit.onStateChanged(setState);
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);

  const remaining = useMemo(() => {
    const positions = new Map(state.taskOrder.map((id, index) => [id, index]));
    return state.tasks
      .filter((task) => task.status !== 'done' && task.plannedDate === today && !deletingIds.includes(task.id))
      .toSorted((a, b) => {
        const aPosition = positions.get(a.id);
        const bPosition = positions.get(b.id);
        if (aPosition !== undefined || bPosition !== undefined) return (aPosition ?? Infinity) - (bPosition ?? Infinity);
        return a.priority.localeCompare(b.priority) || a.createdAt.localeCompare(b.createdAt);
      });
  }, [state.tasks, state.taskOrder, deletingIds, today]);
  const displayedRemaining = useMemo(() => {
    if (!dragOrder || dragOrder.length !== remaining.length) return remaining;
    const byId = new Map(remaining.map((task) => [task.id, task]));
    const ordered = dragOrder.map((id) => byId.get(id)).filter((task): task is Task => Boolean(task));
    return ordered.length === remaining.length ? ordered : remaining;
  }, [remaining, dragOrder]);
  const completed = useMemo(() => completedForDate(state.tasks, today, deletingIds), [state.tasks, deletingIds, today]);
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

  useEffect(() => {
    if (!draftNotice) return;
    const timer = window.setTimeout(() => setDraftNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [draftNotice]);

  useEffect(() => {
    if (!dragOrder) return;
    const timer = window.setInterval(() => {
      const position = dragPositionRef.current;
      const scroller = document.querySelector<HTMLElement>('.page.home');
      if (!position || !scroller) return;
      const viewport = scroller.getBoundingClientRect();
      const previous = scroller.scrollTop;
      if (position.y < viewport.top + 42) scroller.scrollTop -= 10;
      else if (position.y > viewport.bottom - 42) scroller.scrollTop += 10;
      if (scroller.scrollTop !== previous) moveTaskDrag(position.id, position.y, position.xOffset, position.yOffset, false);
    }, 30);
    return () => window.clearInterval(timer);
  }, [Boolean(dragOrder)]);

  async function deleteTask(id: string) {
    clearTaskDrag();
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

  function clearTaskDrag() {
    dragOrderRef.current = null;
    dragPositionRef.current = null;
    setDragOrder(null);
  }

  function startTaskDrag() {
    taskDragging.current = true;
    const ids = remaining.map((task) => task.id);
    dragOrderRef.current = ids;
    setDragOrder(ids);
  }

  function moveTaskDrag(id: string, pointerY: number, offsetX: number, offsetY: number, scroll = true) {
    if (!dragOrderRef.current) return;
    dragPositionRef.current = { id, y: pointerY, xOffset: offsetX, yOffset: offsetY };
    if (Math.abs(offsetX) > 24 && Math.abs(offsetX) > Math.abs(offsetY) * 1.15) {
      const original = remaining.map((task) => task.id);
      if (!dragOrderRef.current.every((candidate, index) => candidate === original[index])) {
        dragOrderRef.current = original;
        setDragOrder(original);
      }
      return;
    }
    const scroller = document.querySelector<HTMLElement>('.page.home');
    if (scroller && scroll) {
      const viewport = scroller.getBoundingClientRect();
      if (pointerY < viewport.top + 42) scroller.scrollTop -= 12;
      else if (pointerY > viewport.bottom - 42) scroller.scrollTop += 12;
    }
    const current = dragOrderRef.current;
    const others = current.filter((candidate) => candidate !== id);
    const slots = [...document.querySelectorAll<HTMLElement>('.list .task-slot')];
    const insertAt = others.findIndex((candidate) => {
      const slot = slots.find((element) => element.dataset.taskId === candidate);
      if (!slot) return false;
      const bounds = slot.getBoundingClientRect();
      return pointerY < bounds.top + bounds.height / 2;
    });
    const reordered = moveTaskId(current, id, insertAt);
    if (reordered.every((candidate, index) => candidate === current[index])) return;
    dragOrderRef.current = reordered;
    setDragOrder(reordered);
  }

  function reorderTask(id: string, pointerY: number) {
    moveTaskDrag(id, pointerY, 0, 0, false);
    const order = dragOrderRef.current;
    dragPositionRef.current = null;
    if (!order || order.every((candidate, index) => candidate === remaining[index]?.id)) { clearTaskDrag(); return; }
    void window.doit.reorderTasks(order).then(() => { if (dragOrderRef.current === order) clearTaskDrag(); }).catch((cause) => {
      if (dragOrderRef.current === order) clearTaskDrag();
      window.alert(cause instanceof Error ? cause.message : '순서를 바꾸지 못했어요.');
    });
  }

  function open(next: 'home' | 'add' | 'settings' = 'home') {
    if (draftDirty && (page === 'add' || page === 'edit')) {
      setDraftNotice(draftWarning);
      return;
    }
    if (next === 'add') setDraftDirty(false);
    setPage(next);
    setExpanded(true);
    void window.doit.setExpanded(true);
  }

  function collapse() {
    if (collapsingRef.current) return;
    if (draftDirty && (page === 'add' || page === 'edit')) {
      setDraftNotice(draftWarning);
      return;
    }
    collapsingRef.current = true;
    setCollapsing(true);
    void window.doit.setExpanded(false).then(() => {
      setPage('home');
      setExpanded(false);
      setCollapsing(false);
      collapsingRef.current = false;
    }).catch(() => {
      setCollapsing(false);
      collapsingRef.current = false;
    });
  }

  function handleSurfaceClick(event: React.MouseEvent<HTMLElement>) {
    if (!expanded || page === 'add' || page === 'edit' || taskDragging.current || Date.now() - lastDragAt.current < 800) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button, input, textarea, select, a, .archive-task, [role="checkbox"], [role="menuitem"], [contenteditable="true"]')) return;
    collapse();
  }

  function closeEditor() {
    if (draftDirty) {
      setDraftNotice(draftWarning);
      return;
    }
    setPage('home');
  }

  function savedEditor() {
    setDraftDirty(false);
    setDraftNotice(null);
    setPage('home');
  }

  function startPreviewDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.currentTarget.classList.contains('collapsed-inner') && event.target !== event.currentTarget)) return;
    suppressPreviewClick.current = false;
    previewDrag.current = { source: event.currentTarget, screenX: event.screenX, screenY: event.screenY, windowX: window.screenX, windowY: window.screenY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePreview(event: React.PointerEvent<HTMLElement>) {
    const drag = previewDrag.current;
    if (!drag || drag.source !== event.currentTarget) return;
    const dx = event.screenX - drag.screenX;
    const dy = event.screenY - drag.screenY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    suppressPreviewClick.current = true;
    void window.doit.moveWindow(Math.round(drag.windowX + dx), Math.round(drag.windowY + dy));
  }

  function finishPreviewDrag(event: React.PointerEvent<HTMLElement>) {
    if (previewDrag.current?.source === event.currentTarget) previewDrag.current = null;
  }

  function openFromPreview(event: React.MouseEvent<HTMLButtonElement>, next: 'home' | 'add' = 'home') {
    if (suppressPreviewClick.current) { suppressPreviewClick.current = false; event.preventDefault(); return; }
    open(next);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && expanded) collapse(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded, page, draftDirty]);

  useEffect(() => {
    if (!expanded) return;
    return window.doit.onOutsideClick(() => {
      if (!taskDragging.current && Date.now() - lastDragAt.current >= 800) collapse();
    });
  }, [expanded, page, draftDirty]);

  const toggle = (id: string) => void window.doit.toggleTask(id);
  const changePriority = (id: string, priority: Priority) => void window.doit.setTaskPriority(id, priority);
  const editTask = (id: string) => { setDraftDirty(false); setEditingTaskId(id); setPage('edit'); };
  if (!loaded) return <main className="shell loading"><Bosongi /><span>두잇 준비 중…</span></main>;

  return <MotionConfig reducedMotion="user">
    <main className={`shell ${expanded ? 'expanded' : 'collapsed'} ${collapsing ? 'morphing-close' : ''} ${hovered && !expanded ? 'preview-open' : ''}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={handleSurfaceClick}>
      <button type="button" className="widget-close floating-close interactive" aria-label="Do it 종료" title="앱 종료" onClick={(event) => { event.stopPropagation(); if (draftDirty && (page === 'add' || page === 'edit')) setDraftNotice(draftWarning); else void window.doit.quitApp(); }}><X className="size-3" /></button>
      {!expanded ? (
        <motion.div className="collapsed-inner" title="빈 공간을 드래그해 위젯을 옮길 수 있어요" initial={{ opacity: 0, scale: 1.025, filter: 'blur(3px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: .34, ease: [.22, 1, .36, 1] }} onPointerDown={startPreviewDrag} onPointerMove={movePreview} onPointerUp={finishPreviewDrag} onPointerCancel={finishPreviewDrag}>
          <AnimatePresence initial={false}>
            {remaining.slice(0, hovered ? 3 : 1).map((task, index) => <motion.button type="button" key={task.id} className={`preview-card interactive ${index === 0 ? 'current' : 'next'}`} initial={{ y: 0, scale: .7, opacity: 0, filter: 'blur(3px)' }} animate={{ y: [0, 34, 65][index], scale: index === 0 ? 1 : index === 1 ? .78 : .72, opacity: 1 - index * .16, filter: 'blur(0px)' }} exit={{ y: -38, scale: .7, opacity: 0, filter: 'blur(2px)' }} transition={{ type: 'spring', stiffness: 420, damping: 29, delay: index * .045 }} style={{ zIndex: 3 - index }} onPointerDown={startPreviewDrag} onPointerMove={movePreview} onPointerUp={finishPreviewDrag} onPointerCancel={finishPreviewDrag} onClick={(event) => openFromPreview(event)} aria-label={`${task.title} · 할 일 목록 열기`}>
              <div className="preview-content">
                {index === 0 && meeting ? <div className="preview-meeting"><span>{formatTimeRange(meeting)}</span><strong>{state.settings.privacyMode ? '회의 예정' : meeting.title}</strong></div> : null}
                <div className="preview-task"><Badge variant="secondary" className={`priority ${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].label}</Badge><strong>{state.settings.privacyMode ? '할 일' : task.title}</strong></div>
              </div>
              {index === 0 ? <Chevron /> : null}
            </motion.button>)}
          </AnimatePresence>
          {!remaining.length ? <button type="button" className="preview-card current preview-empty interactive" onPointerDown={startPreviewDrag} onPointerMove={movePreview} onPointerUp={finishPreviewDrag} onPointerCancel={finishPreviewDrag} onClick={(event) => openFromPreview(event, 'add')}><span>오늘 할 일을 추가해볼까요?</span><Chevron /></button> : null}
        </motion.div>
      ) : (
        <motion.div className="expanded-inner" initial={{ opacity: 0, scale: .975, filter: 'blur(3px)' }} animate={collapsing ? { opacity: 0, scale: .97, filter: 'blur(3px)' } : { opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: collapsing ? .2 : .38, ease: [.22, 1, .36, 1] }}>
          <header>
            <div className="header-leading"><Button variant="ghost" className="brand interactive" aria-label="위젯 접기" onClick={collapse}><Bosongi animated /></Button></div>
            <div><div className="window-grip" title="위젯 위치 이동" aria-label="위젯 위치 이동"><GripHorizontal className="size-4" /></div><Button variant="ghost" size="icon" className="icon interactive" aria-label="설정" onClick={() => { if (draftDirty && (page === 'add' || page === 'edit')) setDraftNotice(draftWarning); else setPage('settings'); }}><Settings2 className="size-4" /></Button><Button variant="ghost" size="icon" className="icon interactive" aria-label="접기" onClick={collapse}><Chevron up /></Button></div>
          </header>
          {page === 'add' ? <AddTask onClose={closeEditor} onSaved={savedEditor} onDirtyChange={setDraftDirty} notionPages={todayNotionPages} /> : page === 'edit' && editingTask ? <EditTask key={editingTask.id} task={editingTask} onClose={closeEditor} onSaved={savedEditor} onDirtyChange={setDraftDirty} notionPages={todayNotionPages} /> : page === 'settings' ? <SettingsPage state={state} onBack={() => setPage('home')} /> : (
            <section className="page home">
              <div className="timeline"><h2>오늘 일정</h2>{todayEvents.length ? <div className="timeline-cards" role="list">{todayEvents.map((event) => <div className="timeline-card" role="listitem" key={event.id}><time>{formatTimeRange(event)}</time><strong>{state.settings.privacyMode ? '회의 일정' : event.title}</strong></div>)}</div> : <p>오늘 일정이 없어요.</p>}</div>
              {meeting ? <div className="meeting-card"><span>{new Date(meeting.startAt) <= now ? '회의 중' : '곧 시작하는 회의'}</span><strong>{formatTimeRange(meeting)} · {state.settings.privacyMode ? '회의 예정' : meeting.title}</strong></div> : null}
              <div className="heading"><h1>남은 할 일 <span className="task-count">{remaining.length}개</span></h1><Button variant="ghost" className="add-trigger" onClick={() => setPage('add')}><Plus className="size-4" /> 추가</Button></div>
              <div className="list"><AnimatePresence initial={false}>{displayedRemaining.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} onPriority={changePriority} onEdit={editTask} onDelete={deleteTask} onDragStart={startTaskDrag} onDragMove={moveTaskDrag} onReorder={reorderTask} onDragFinish={() => { taskDragging.current = false; lastDragAt.current = Date.now(); }} />)}</AnimatePresence></div>
              {!remaining.length ? <div className="all-done"><Bosongi animated /><strong>{completed.length ? '오늘 할 일을 모두 마쳤어요' : '오늘 할 일이 아직 없어요'}</strong><Button variant="secondary" onClick={() => setPage('add')}>할 일 추가하기</Button></div> : null}
              {completed.length ? <div className="completed-list"><Button variant="ghost" onClick={() => setShowCompleted((value) => !value)}>완료한 일 {completed.length}개 <Chevron up={showCompleted} /></Button><AnimatePresence initial={false}>{showCompleted ? completed.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} onPriority={changePriority} onEdit={editTask} onDelete={deleteTask} onDragStart={() => { taskDragging.current = true; }} onDragFinish={() => { taskDragging.current = false; lastDragAt.current = Date.now(); }} />) : null}</AnimatePresence></div> : null}
              <AnimatePresence>{undoTask ? <motion.div className="undo-toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} role="status"><span>할 일을 삭제했어요</span><Button variant="secondary" className="undo-action" onClick={() => void restoreTask()}>되돌리기</Button></motion.div> : null}</AnimatePresence>
            </section>
          )}
          <AnimatePresence>{draftNotice ? <motion.div className="draft-toast" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>{draftNotice}</motion.div> : null}</AnimatePresence>
        </motion.div>
      )}
    </main>
  </MotionConfig>;
}
