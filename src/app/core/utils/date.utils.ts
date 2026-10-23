export type { DateOnly } from './date-only.utils';
export {
  isDateOnly,
  assertDateOnly,
  parseDateOnly,
  toDateOnly,
  toLocalDate,
  addDaysToDateOnly,
  todayDateOnly,
  compareDateOnly,
  isPastDateOnly,
  isTodayOrFutureDateOnly,
  formatLongDisplayDate,
  formatShortDisplayDate,
  formatWeekdayDisplayDate,
  calendarViewRangeInclusive,
} from './date-only.utils';

import {
  addDaysToDateOnly,
  formatShortDisplayDate,
  todayDateOnly,
  toDateOnly,
  toLocalDate,
  type DateOnly,
} from './date-only.utils';

/** @deprecated Prefer toDateOnly */
export function formatDateISO(date: Date): DateOnly {
  return toDateOnly(date);
}

/** @deprecated Prefer toLocalDate */
export function parseISODate(iso: DateOnly): Date {
  return toLocalDate(iso);
}

export function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

export function addDaysISO(iso: DateOnly, days: number): DateOnly {
  return addDaysToDateOnly(iso, days);
}

/** @deprecated Prefer todayDateOnly */
export function todayISO(): DateOnly {
  return todayDateOnly();
}

/** @deprecated Prefer isPastDateOnly */
export function isPastDate(iso: DateOnly): boolean {
  return iso < todayDateOnly();
}

/** @deprecated Prefer isTodayOrFutureDateOnly */
export function isTodayOrFuture(iso: DateOnly): boolean {
  return iso >= todayDateOnly();
}

/** @deprecated Prefer formatShortDisplayDate */
export function formatDisplayDate(iso: DateOnly): string {
  return formatShortDisplayDate(iso);
}
