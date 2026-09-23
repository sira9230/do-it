export function formatReminderInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 6) return `${digits.slice(0, 2)}.${digits.slice(2, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)} ${digits.slice(4, 6)}:${digits.slice(6)}`;
}

export function parseReminderInput(value: string, now = new Date()): string | null {
  if (!value.trim()) return null;
  const match = /^(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('리마인드를 MM.DD 00:00 형식으로 입력해주세요.');
  const [, month, day, hour, minute] = match;
  const year = now.getFullYear();
  const date = new Date(year, Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (date.getFullYear() !== year || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)
    || date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute) || date.getTime() <= now.getTime()) {
    throw new Error('현재보다 뒤의 올바른 날짜와 시간을 입력해주세요.');
  }
  return date.toISOString();
}
