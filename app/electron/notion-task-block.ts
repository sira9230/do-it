import type { Priority } from './types.js';

export function notionTodoBlock(title: string, summary: string, priority: Priority, checked = false, inProgress = false) {
  const code = priority === 'P3' ? '추후 진행' : priority;
  const color = priority === 'P1' ? 'red_background' : priority === 'P3' ? 'gray_background' : 'blue_background';
  return {
    object: 'block',
    type: 'to_do',
    to_do: {
      rich_text: [
        { type: 'text', text: { content: title } },
        { type: 'text', text: { content: ' ' } },
        { type: 'text', text: { content: code }, annotations: { code: true } },
        ...(inProgress ? [
          { type: 'text', text: { content: ' ' } },
          { type: 'text', text: { content: '진행중' }, annotations: { code: true } },
        ] : []),
      ],
      checked,
      color,
    },
    ...(summary.trim() ? { children: [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: summary.trim() } }] },
    }] } : {}),
  };
}

export function notionTodoAppendBody(title: string, summary: string, priority: Priority, checked = false, inProgress = false) {
  return { children: [notionTodoBlock(title, summary, priority, checked, inProgress)], position: { type: 'start' } };
}
