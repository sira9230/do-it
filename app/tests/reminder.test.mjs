import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReminderInput, parseReminderInput } from '../src/reminder.ts';

test('숫자 8개를 월일과 시간 형식으로 변환한다', () => {
  assert.equal(formatReminderInput('09231430'), '09.23 14:30');
  assert.equal(formatReminderInput('09.23 14:30'), '09.23 14:30');
  assert.equal(formatReminderInput('0923'), '09.23');
});

test('리마인드는 올해의 미래 시각만 저장한다', () => {
  const now = new Date(2026, 8, 22, 12, 0);
  assert.equal(parseReminderInput('', now), null);
  assert.equal(parseReminderInput('09.23 14:30', now), new Date(2026, 8, 23, 14, 30).toISOString());
  assert.throws(() => parseReminderInput('09.21 14:30', now));
  assert.throws(() => parseReminderInput('02.30 14:30', now));
  assert.throws(() => parseReminderInput('09.23 25:00', now));
});
