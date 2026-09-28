import assert from 'node:assert/strict';
import test from 'node:test';
import { completedForDate, localCompletedHistory } from '../src/task-views.ts';

const task = (id, plannedDate, completedAt, notionBlockId) => ({
  id, plannedDate, completedAt, notionBlockId,
  createdAt: `${plannedDate}T09:00:00+09:00`,
  status: 'done',
});

test('홈에는 오늘 완료한 항목만 표시하고 지난 날짜의 퇴근 항목은 숨긴다', () => {
  const tasks = [
    task('퇴근', '2026-09-27', '2026-09-27T18:00:00+09:00'),
    task('오늘 완료', '2026-09-28', '2026-09-28T10:00:00+09:00'),
  ];
  assert.deepEqual(completedForDate(tasks, '2026-09-28').map((item) => item.id), ['오늘 완료']);
});

test('설정의 완료 기록에는 앱에서 만든 항목만 날짜에 관계없이 남는다', () => {
  const tasks = [
    task('어제 완료', '2026-09-27', '2026-09-27T18:00:00+09:00'),
    task('노션 완료', '2026-09-28', '2026-09-28T11:00:00+09:00', 'notion-block'),
    task('오늘 완료', '2026-09-28', '2026-09-28T10:00:00+09:00'),
  ];
  assert.deepEqual(localCompletedHistory(tasks).map((item) => item.id), ['오늘 완료', '어제 완료']);
});
