import { DateOnly } from './date-only.utils';

/** Normalize DB `time` (HH:MM:SS) or input (HH:MM) to HH:MM for `<input type="time">`. */
export function toTimeInputValue(value?: string | null, fallback = '08:00'): string {
  if (!value?.trim()) return fallback;
  return value.trim().slice(0, 5);
}

/** Combine date + local wall time into FullCalendar-friendly ISO (no timezone suffix). */
export function toLocalDateTimeIso(date: DateOnly, time?: string | null, fallback = '08:00'): string {
  const normalized = toTimeInputValue(time, fallback);
  return `${date}T${normalized}:00`;
}

/** Display range e.g. "08:00 – 09:30". */
export function formatStudyTimeRange(
  start?: string | null,
  end?: string | null,
  emptyLabel = '—',
): string {
  const startLabel = toTimeInputValue(start, '');
  const endLabel = toTimeInputValue(end, '');
  if (!startLabel || !endLabel) return emptyLabel;
  return `${startLabel} – ${endLabel}`;
}
