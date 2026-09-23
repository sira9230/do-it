import assert from 'node:assert/strict';
import test from 'node:test';
import { inlinePriority, inlineTaskStatus, replaceVisibleTitle, visibleText } from '../dist-electron/notion-rich-text.js';

test('editing a Notion task keeps the inline priority code and unchanged formatting', () => {
  const parts = [
    { type: 'text', text: { content: '메뉴 아이콘 제작 ' }, annotations: { bold: true }, plain_text: '메뉴 아이콘 제작 ' },
    { type: 'text', text: { content: '진행중' }, annotations: { code: true, color: 'blue' }, plain_text: '진행중' },
    { type: 'text', text: { content: ' ' }, plain_text: ' ' },
    { type: 'text', text: { content: 'P1' }, annotations: { code: true }, plain_text: 'P1' },
  ];
  const edited = replaceVisibleTitle(parts, '새 메뉴 아이콘 제작');
  assert.equal(visibleText(edited), '새 메뉴 아이콘 제작');
  assert.equal(inlinePriority(edited), 'P1');
  assert.equal(inlineTaskStatus(edited), '진행중');
  assert.ok(edited.some((part) => part.text?.content === '진행중' && part.annotations?.color === 'blue'));
  assert.ok(edited.every((part) => !('plain_text' in part) && !('href' in part)));
});

test('추후 진행 maps to low priority, while legacy P3 no longer means low', () => {
  const code = (content) => ({ type: 'text', text: { content }, annotations: { code: true }, plain_text: content });
  assert.equal(inlinePriority([code('추후 진행')]), 'P3');
  assert.equal(inlinePriority([code('P3')]), null);
  assert.equal(visibleText([{ type: 'text', text: { content: '나중에 할 일 ' } }, code('추후 진행')]), '나중에 할 일');
});

test('Notion inline progress and completion codes stay out of task title', () => {
  const code = (content) => ({ type: 'text', text: { content }, annotations: { code: true }, plain_text: content });
  assert.equal(inlineTaskStatus([code('진행중')]), '진행중');
  assert.equal(inlineTaskStatus([code('완료')]), '완료');
  assert.equal(visibleText([{ type: 'text', text: { content: '할 일 ' } }, code('완료')]), '할 일');
});

test('editing a task without priority code does not add one', () => {
  const edited = replaceVisibleTitle([{ type: 'text', text: { content: '이전 할 일' }, plain_text: '이전 할 일' }], '새 할 일');
  assert.equal(visibleText(edited), '새 할 일');
  assert.equal(inlinePriority(edited), null);
});
