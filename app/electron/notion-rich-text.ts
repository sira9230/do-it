import type { Priority } from './types.js';

export interface NotionRichText {
  type?: string;
  plain_text?: string;
  text?: { content: string; link?: { url: string } | null };
  annotations?: { code?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

export function isPriorityCode(part: NotionRichText) {
  return part.annotations?.code === true && !!part.text && /^P[123]$/i.test((part.plain_text ?? part.text.content).trim());
}

export function visibleText(parts: NotionRichText[]) {
  return parts.filter((part) => !isPriorityCode(part))
    .map((part) => part.plain_text ?? part.text?.content ?? '').join('').replace(/\s{2,}/g, ' ').trim();
}

export function inlinePriority(parts: NotionRichText[]): Priority | null {
  const code = parts.find(isPriorityCode);
  return code ? (code.plain_text ?? code.text?.content ?? '').trim().toUpperCase() as Priority : null;
}

export function writableRichText(part: NotionRichText): NotionRichText {
  const { plain_text: _plainText, href: _href, ...writable } = part;
  return writable;
}

function fragment(part: NotionRichText, content: string): NotionRichText {
  if (part.text) return { ...writableRichText(part), text: { ...part.text, content } };
  return { type: 'text', text: { content } };
}

export function replaceVisibleTitle(parts: NotionRichText[], nextTitle: string): NotionRichText[] {
  const visible = parts.filter((part) => !isPriorityCode(part));
  const codes = parts.filter(isPriorityCode).map(writableRichText);
  const oldTitle = visible.map((part) => part.plain_text ?? part.text?.content ?? '').join('').trimEnd();
  let prefix = 0;
  while (prefix < oldTitle.length && prefix < nextTitle.length && oldTitle[prefix] === nextTitle[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldTitle.length - prefix && suffix < nextTitle.length - prefix
    && oldTitle[oldTitle.length - suffix - 1] === nextTitle[nextTitle.length - suffix - 1]) suffix++;

  const before: NotionRichText[] = [];
  const after: NotionRichText[] = [];
  let offset = 0;
  for (const part of visible) {
    const content = (part.plain_text ?? part.text?.content ?? '').slice(0, Math.max(0, oldTitle.length - offset));
    const end = offset + content.length;
    const beforeLength = Math.max(0, Math.min(end, prefix) - offset);
    const afterStart = Math.max(offset, oldTitle.length - suffix);
    if (beforeLength) before.push(fragment(part, content.slice(0, beforeLength)));
    if (afterStart < end) after.push(fragment(part, content.slice(afterStart - offset)));
    offset = end;
  }

  const inserted = nextTitle.slice(prefix, nextTitle.length - suffix);
  const result: NotionRichText[] = [...before];
  if (inserted) result.push({ type: 'text', text: { content: inserted } });
  result.push(...after);
  if (codes.length) {
    const last = result.at(-1)?.text?.content ?? '';
    const firstCode = codes[0].text?.content ?? '';
    if (last && !/\s$/.test(last) && !/^\s/.test(firstCode)) result.push({ type: 'text', text: { content: ' ' } });
    result.push(...codes);
  }
  return result;
}
