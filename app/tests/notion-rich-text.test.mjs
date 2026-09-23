import assert from 'node:assert/strict';
import test from 'node:test';
import { inlinePriority, replaceVisibleTitle, visibleText } from '../dist-electron/notion-rich-text.js';

test('editing a Notion task keeps the inline priority code and unchanged formatting', () => {
  const parts = [
    { type: 'text', text: { content: '메뉴 아이콘 제작 ' }, annotations: { bold: true }, plain_text: '메뉴 아이콘 제작 ' },
    { type: 'text', text: { content: '진행중' }, annotations: { code: true, color: 'blue' }, plain_text: '진행중' },
    { type: 'text', text: { content: ' ' }, plain_text: ' ' },
    { type: 'text', text: { content: 'P1' }, annotations: { code: true }, plain_text: 'P1' },
  ];
  const edited = replaceVisibleTitle(parts, '새 메뉴 아이콘 제작 진행중');
  assert.equal(visibleText(edited), '새 메뉴 아이콘 제작 진행중');
  assert.equal(inlinePriority(edited), 'P1');
  assert.ok(edited.some((part) => part.text?.content === '진행중' && part.annotations?.color === 'blue'));
  assert.ok(edited.every((part) => !('plain_text' in part) && !('href' in part)));
});

test('editing a task without priority code does not add one', () => {
  const edited = replaceVisibleTitle([{ type: 'text', text: { content: '이전 할 일' }, plain_text: '이전 할 일' }], '새 할 일');
  assert.equal(visibleText(edited), '새 할 일');
  assert.equal(inlinePriority(edited), null);
});
