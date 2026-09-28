import type { Task } from './types';

export function completedForDate(tasks: Task[], date: string, deletingIds: string[] = []) {
  return tasks.filter((task) => task.status === 'done' && task.plannedDate === date && !deletingIds.includes(task.id));
}

export function localCompletedHistory(tasks: Task[]) {
  return tasks.filter((task) => !task.notionBlockId && task.status === 'done')
    .toSorted((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
}
