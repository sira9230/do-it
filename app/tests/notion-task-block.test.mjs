import assert from 'node:assert/strict';
import test from 'node:test';
import { notionTodoAppendBody } from '../dist-electron/notion-task-block.js';

test('새 할 일은 페이지 상단의 체크박스와 코드형 중요도, 하위 설명으로 생성된다', () => {
  const body = notionTodoAppendBody('화면 검토', '시안 두 개 비교', 'P1');
  assert.deepEqual(body.position, { type: 'start' });
  const task = body.children[0];
  assert.equal(task.type, 'to_do');
  assert.equal(task.to_do.checked, false);
  assert.equal(task.to_do.color, 'red_background');
  assert.equal(task.to_do.rich_text[2].text.content, 'P1');
  assert.equal(task.to_do.rich_text[2].annotations.code, true);
  assert.equal(task.children?.[0].paragraph.rich_text[0].text.content, '시안 두 개 비교');
});

test('추후 진행은 기존 Notion 코드 표기를 따르고 설명이 없으면 하위 블록을 만들지 않는다', () => {
  const task = notionTodoAppendBody('나중에 확인', '', 'P3').children[0];
  assert.equal(task.to_do.rich_text[2].text.content, '추후 진행');
  assert.equal(task.to_do.color, 'gray_background');
  assert.equal('children' in task, false);
});

test('완료한 앱 할 일을 옮기면 Notion 체크박스도 완료 상태로 생성된다', () => {
  const task = notionTodoAppendBody('완료된 일', '결과 정리', 'P2', true).children[0];
  assert.equal(task.to_do.checked, true);
  assert.equal(task.to_do.rich_text[2].text.content, 'P2');
});
