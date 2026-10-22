/**
 * Date-only values (PostgreSQL DATE, HTML date input).
 * Always YYYY-MM-DD — never use toISOString() for calendar dates.
 */
export type DateOnly = string;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string): value is DateOnly {
  return DATE_ONLY_PATTERN.test(value);
}

export function assertDateOnly(value: string, label = 'date'): DateOnly {
  if (!isDateOnly(value)) {
    throw new Error(`Invalid date-only ${label}: ${value}`);
  }
  return value;
}

/** Parse YYYY-MM-DD into local calendar parts (no timezone shift). */
export function parseDateOnly(iso: DateOnly): { year: number; month: number; day: number } {
  const match = DATE_ONLY_PATTERN.exec(iso);
  if (!match) {
    throw new Error(`Invalid date-only: ${iso}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** Build YYYY-MM-DD from local Date (uses local calendar fields). */
export function toDateOnly(date: Date): DateOnly {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local Date at midnight for a date-only value. */
export function toLocalDate(iso: DateOnly): Date {
  const { year, month, day } = parseDateOnly(iso);
  return new Date(year, month - 1, day);
}

export function addDaysToDateOnly(iso: DateOnly, days: number): DateOnly {
  const date = toLocalDate(iso);
  date.setDate(date.getDate() + days);
  return toDateOnly(date);
}

export function todayDateOnly(): DateOnly {
  return toDateOnly(new Date());
}

export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  return a.localeCompare(b);
}

export function isPastDateOnly(iso: DateOnly): boolean {
  return compareDateOnly(iso, todayDateOnly()) < 0;
}

export function isTodayOrFutureDateOnly(iso: DateOnly): boolean {
  return compareDateOnly(iso, todayDateOnly()) >= 0;
}

/** e.g. 20 October 2026 */
export function formatLongDisplayDate(iso: DateOnly, locale = 'en-GB'): string {
  const { year, month, day } = parseDateOnly(iso);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** e.g. 20/10/2026 (vi-VN) */
export function formatShortDisplayDate(iso: DateOnly, locale = 'vi-VN'): string {
  const { year, month, day } = parseDateOnly(iso);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

/**
 * FullCalendar `datesSet` end is exclusive (midnight after last visible day).
 * Returns inclusive from/to as date-only strings.
 */
export function calendarViewRangeInclusive(
  activeStart: Date,
  activeEndExclusive: Date,
): { fromDate: DateOnly; toDate: DateOnly } {
  const fromDate = toDateOnly(activeStart);
  const endLocal = new Date(activeEndExclusive);
  endLocal.setDate(endLocal.getDate() - 1);
  const toDate = toDateOnly(endLocal);
  return { fromDate, toDate };
}
