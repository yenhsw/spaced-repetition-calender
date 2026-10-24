/// <reference path="../edge-runtime.d.ts" />

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export const DAILY_DIGEST_TIME = '08:30';
export const TASK_LEAD_MINUTES = 10;

export interface TodayTaskItem {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  reminderTime: string | null;
  kind: 'study' | 'review';
}

interface StudyTopicRow {
  id: string;
  title: string;
  study_start_time: string | null;
  study_end_time: string | null;
  reminder_time: string | null;
}

interface ReviewRow {
  id: string;
  day_offset: number;
  review_date: string;
  study_topic: StudyTopicRow | StudyTopicRow[] | null;
}

export function todayDateInTimezone(timezone: string): string {
  const tz = timezone?.trim() || 'Asia/Ho_Chi_Minh';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Parse HH:MM or HH:MM:SS → hour/minute (24h). */
export function parseClockTime(value?: string | null): { hour: number; minute: number } | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().slice(0, 8);
  const [hourPart, minutePart = '0'] = normalized.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour: hour === 24 ? 0 : hour, minute };
}

/** Subtract minutes from a wall-clock time, wrapping past midnight. */
export function subtractMinutesFromClock(
  hour: number,
  minute: number,
  deltaMinutes: number,
): { hour: number; minute: number } {
  let total = hour * 60 + minute - deltaMinutes;
  while (total < 0) total += 24 * 60;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

export function isLocalTimeMatch(
  localHour: number,
  localMinute: number,
  targetHour: number,
  targetMinute: number,
): boolean {
  return localHour === targetHour && localMinute === targetMinute;
}

function formatClock(value?: string | null): string {
  if (!value?.trim()) return '';
  return value.trim().slice(0, 5);
}

export function formatTimeRange(start?: string | null, end?: string | null): string {
  const startLabel = formatClock(start);
  const endLabel = formatClock(end);
  if (!startLabel || !endLabel) return '—';
  return `${startLabel} - ${endLabel}`;
}

function sortKey(start?: string | null): string {
  return formatClock(start) || '99:99';
}

function unwrapTopic(topic: StudyTopicRow | StudyTopicRow[] | null): StudyTopicRow | null {
  if (!topic) return null;
  return Array.isArray(topic) ? topic[0] ?? null : topic;
}

export async function getTodayTasks(args: {
  supabase: SupabaseClient;
  userId: string;
  timezone?: string;
}): Promise<{ today: string; items: TodayTaskItem[]; count: number; studyCount: number; reviewCount: number }> {
  const today = todayDateInTimezone(args.timezone ?? 'Asia/Ho_Chi_Minh');

  const [studiesResult, reviewsResult] = await Promise.all([
    args.supabase
      .from('study_topics')
      .select('id, title, study_start_time, study_end_time, reminder_time')
      .eq('user_id', args.userId)
      .eq('study_date', today)
      .order('study_start_time', { ascending: true }),
    args.supabase
      .from('study_reviews')
      .select('id, day_offset, review_date, study_topic:study_topics(title, study_start_time, study_end_time, reminder_time)')
      .eq('user_id', args.userId)
      .eq('status', 'PENDING')
      .lte('review_date', today)
      .order('review_date', { ascending: true }),
  ]);

  if (studiesResult.error) throw new Error(studiesResult.error.message);
  if (reviewsResult.error) throw new Error(reviewsResult.error.message);

  const items: TodayTaskItem[] = [];

  for (const study of studiesResult.data ?? []) {
    const row = study as StudyTopicRow;
    items.push({
      kind: 'study',
      id: row.id,
      title: row.title?.trim() || 'Học',
      startTime: row.study_start_time,
      endTime: row.study_end_time,
      reminderTime: row.reminder_time,
    });
  }

  for (const review of reviewsResult.data ?? []) {
    const row = review as ReviewRow;
    const topic = unwrapTopic(row.study_topic);
    const offset = row.day_offset > 0 ? `N+${row.day_offset}` : `N${row.day_offset}`;
    const topicTitle = topic?.title?.trim() || 'Ôn tập';
    items.push({
      kind: 'review',
      id: row.id,
      title: `${offset} · ${topicTitle}`,
      startTime: topic?.study_start_time ?? null,
      endTime: topic?.study_end_time ?? null,
      reminderTime: topic?.reminder_time ?? null,
    });
  }

  items.sort((a, b) => sortKey(a.startTime).localeCompare(sortKey(b.startTime)));

  const studyCount = studiesResult.data?.length ?? 0;
  const reviewCount = reviewsResult.data?.length ?? 0;

  return {
    today,
    items,
    studyCount,
    reviewCount,
    count: items.length,
  };
}

/** @deprecated use getTodayTasks */
export async function getTodayTaskCount(args: {
  supabase: SupabaseClient;
  userId: string;
  timezone?: string;
}): Promise<{ count: number; today: string; studyCount: number; reviewCount: number }> {
  const result = await getTodayTasks(args);
  return {
    today: result.today,
    count: result.count,
    studyCount: result.studyCount,
    reviewCount: result.reviewCount,
  };
}

export function buildTodayPushText(items: TodayTaskItem[]): { title: string; body: string } {
  const count = items.length;
  // iOS adds "từ Spaced Rep" below the title — keep title as "N nội dung" so it reads naturally.
  const title = count > 0 ? `${count} nội dung` : 'Không có nội dung';

  if (count === 0) {
    return { title, body: 'Hôm nay không có bài cần học/ôn.' };
  }

  const lines = items.map(
    (item) => `+ ${formatTimeRange(item.startTime, item.endTime)} => ${item.title}`,
  );

  return {
    title,
    body: lines.join('\n'),
  };
}

export function buildTaskLeadPushText(item: TodayTaskItem): { title: string; body: string } {
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  return {
    title: item.title,
    body: `${timeRange} · Bắt đầu sau ${TASK_LEAD_MINUTES} phút`,
  };
}

export function buildReminderTimePushText(item: TodayTaskItem): { title: string; body: string } {
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const reminderLabel = formatClock(item.reminderTime) || DAILY_DIGEST_TIME;
  return {
    title: item.title,
    body: `${timeRange} · Giờ nhắc ${reminderLabel}`,
  };
}

/** Skip per-topic reminder push when it would duplicate the fixed daily digest. */
export function reminderTimeMatchesDailyDigest(reminderTime?: string | null): boolean {
  const reminder = parseClockTime(reminderTime ?? DAILY_DIGEST_TIME);
  const digest = parseClockTime(DAILY_DIGEST_TIME);
  if (!reminder || !digest) return false;
  return reminder.hour === digest.hour && reminder.minute === digest.minute;
}
