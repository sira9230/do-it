export function moveTaskId(order: string[], draggedId: string, insertAt: number) {
  if (!order.includes(draggedId)) return order;
  const others = order.filter((id) => id !== draggedId);
  const next = [...others];
  next.splice(insertAt < 0 ? others.length : Math.min(insertAt, others.length), 0, draggedId);
  return next;
}
