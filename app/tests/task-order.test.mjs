import assert from 'node:assert/strict';
import test from 'node:test';
import { moveTaskId } from '../src/task-order.ts';

test('드래그한 할 일을 맨 위와 맨 아래로 옮긴다', () => {
  const order = ['first', 'middle', 'last'];
  assert.deepEqual(moveTaskId(order, 'last', 0), ['last', 'first', 'middle']);
  assert.deepEqual(moveTaskId(order, 'first', -1), ['middle', 'last', 'first']);
  assert.deepEqual(order, ['first', 'middle', 'last']);
});

test('목록에 없는 항목은 순서를 바꾸지 않는다', () => {
  const order = ['first', 'last'];
  assert.equal(moveTaskId(order, 'missing', 0), order);
});
