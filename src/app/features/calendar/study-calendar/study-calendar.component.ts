import {
  AfterViewInit,
  Component,
  DestroyRef,
  Input,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { CalendarOptions, EventClickArg, EventContentArg } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import viLocale from '@fullcalendar/core/locales/vi';

import { AuthService } from '../../../core/services/auth.service';
import { StudyTopicService } from '../../../core/services/study-topic.service';
import { StudyReviewService } from '../../../core/services/study-review.service';
import { SpacedRepetitionService } from '../../../core/services/spaced-repetition.service';
import { ReminderSyncService } from '../../../core/services/reminder-sync.service';
import { ReviewScheduleService } from '../../../core/services/review-schedule.service';
import { CalendarEvent, CalendarEventIcon } from '../../../core/models/calendar-event.model';
import {
  applyTopicColorStyles,
  getTopicColorCssVars,
} from '../../../core/utils/topic-color.utils';
import { StudyReview } from '../../../core/models/study-review.model';
import { StudyTopic } from '../../../core/models/study-topic.model';
import { CalendarEventType } from '../../../core/enums/calendar-event-type.enum';
import { ReviewStatus } from '../../../core/enums/review-status.enum';
import { ReviewUiState } from '../../../core/enums/review-ui-state.enum';
import { OffsetPreviewValidation } from '../../../core/services/review-schedule.service';
import { TopicProgressService } from '../../../core/services/topic-progress.service';
import { TopicProgress } from '../../../core/models/topic-progress.model';
import { ScheduleTimelineComponent } from '../../../shared/components/schedule-timeline/schedule-timeline.component';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TranslationService } from '../../../core/i18n/translation.service';
import {
  DEFAULT_STUDY_END_TIME,
  DEFAULT_STUDY_START_TIME,
  DEFAULT_TOPIC_REMINDER_TIME,
} from '../../../core/constants/reminder.constants';
import { formatStudyTimeRange, toTimeInputValue } from '../../../core/utils/study-time.utils';
import {
  addDays,
  addDaysToDateOnly,
  calendarViewRangeInclusive,
  formatLongDisplayDate,
  formatShortDisplayDate,
  formatWeekdayDisplayDate,
  parseDateOnly,
  todayDateOnly,
  toDateOnly,
  toLocalDate,
} from '../../../core/utils/date.utils';
import type { DateOnly } from '../../../core/utils/date.utils';

type ModalMode =
  | 'create-topic'
  | 'topic-detail'
  | 'review-detail'
  | 'edit-schedule'
  | 'edit-topic'
  | 'add-step'
  | 'replace-step'
  | 'daily-events'
  | null;

const CALENDAR_MOBILE_MQ = '(max-width: 767px)';

@Component({
  selector: 'app-study-calendar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FullCalendarModule, ScheduleTimelineComponent, TranslatePipe],
  templateUrl: './study-calendar.component.html',
  styleUrl: './study-calendar.component.scss',
})
export class StudyCalendarComponent implements OnInit, AfterViewInit {
  @Input() userId?: string;
  @Input() readOnly = false;

  @ViewChild(FullCalendarComponent) calendarComponent!: FullCalendarComponent;

  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(TranslationService);
  private readonly authService = inject(AuthService);
  private readonly studyTopicService = inject(StudyTopicService);
  private readonly studyReviewService = inject(StudyReviewService);
  private readonly spacedRepetitionService = inject(SpacedRepetitionService);
  private readonly reminderSync = inject(ReminderSyncService);
  protected readonly reviewScheduleService = inject(ReviewScheduleService);
  protected readonly topicProgressService = inject(TopicProgressService);

  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly scheduleError = signal<string | null>(null);
  protected readonly modalMode = signal<ModalMode>(null);
  protected readonly selectedDate = signal<string | null>(null);
  protected readonly selectedReview = signal<StudyReview | null>(null);
  protected readonly selectedTopic = signal<StudyTopic | null>(null);
  protected readonly selectedEventType = signal<CalendarEventType | null>(null);
  protected readonly dailyEvents = signal<CalendarEvent[]>([]);
  protected readonly isMobileView = signal(false);
  /** User-selected current step offset — required before schedule edits */
  protected readonly currentStepOffset = signal<number | null>(null);

  protected readonly CalendarEventType = CalendarEventType;
  protected readonly ReviewStatus = ReviewStatus;
  protected readonly ReviewUiState = ReviewUiState;
  protected readonly getTopicColorVars = getTopicColorCssVars;

  protected readonly topicForm = this.fb.nonNullable.group(
    {
      title: ['', [Validators.required, Validators.minLength(2)]],
      study_date: ['', Validators.required],
      subject: [''],
      notes: [''],
      resource_url: [''],
      study_start_time: [DEFAULT_STUDY_START_TIME, Validators.required],
      study_end_time: [DEFAULT_STUDY_END_TIME, Validators.required],
      reminder_time: [DEFAULT_TOPIC_REMINDER_TIME, Validators.required],
    },
    { validators: (control) => this.studyTimeRangeValidator(control) },
  );

  protected readonly editTopicForm = this.fb.nonNullable.group(
    {
      title: ['', [Validators.required, Validators.minLength(2)]],
      subject: [''],
      notes: [''],
      resource_url: [''],
      study_start_time: [DEFAULT_STUDY_START_TIME, Validators.required],
      study_end_time: [DEFAULT_STUDY_END_TIME, Validators.required],
      reminder_time: [DEFAULT_TOPIC_REMINDER_TIME, Validators.required],
    },
    { validators: (control) => this.studyTimeRangeValidator(control) },
  );

  protected readonly addStepForm = this.fb.nonNullable.group({
    dayOffset: [20, [Validators.required, Validators.min(1)]],
  });

  protected readonly replaceStepForm = this.fb.nonNullable.group({
    dayOffset: [20, [Validators.required, Validators.min(1)]],
  });

  protected readonly dateFilterForm = this.fb.nonNullable.group({
    fromDate: ['', Validators.required],
    toDate: ['', Validators.required],
  });

  protected readonly dateFilterActive = signal(false);
  protected readonly dateFilterError = signal<string | null>(null);
  protected readonly mobileListMode = signal<'week' | 'month' | 'list'>('month');
  protected readonly mobileListAnchor = signal<DateOnly>(todayDateOnly());

  private readonly defaultHeaderToolbar = {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,listWeek',
  } as const;

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, interactionPlugin, listPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: { ...this.defaultHeaderToolbar },
    views: {},
    buttonText: this.buildCalendarButtonText(),
    locales: [viLocale],
    locale: this.i18n.locale() === 'vi' ? 'vi' : 'en',
    height: 'auto',
    navLinks: true,
    editable: false,
    selectable: false,
    weekends: true,
    dayMaxEvents: false,
    eventDisplay: 'block',
    displayEventTime: true,
    displayEventEnd: true,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventContent: (arg: EventContentArg) => this.renderEventContent(arg),
    dateClick: this.handleDateClick.bind(this),
    eventClick: this.handleEventClick.bind(this),
    datesSet: this.handleDatesSet.bind(this),
  };

  constructor() {
    effect(() => {
      this.i18n.locale();
      this.applyCalendarLocale();
      void this.reloadEventsForLocale();
    });
  }

  ngOnInit(): void {
    if (!this.effectiveUserId) {
      this.errorMessage.set(this.i18n.t('calendar.error.noUser'));
    }

    this.initDateFilterDefaults();

    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia(CALENDAR_MOBILE_MQ);
      this.isMobileView.set(mediaQuery.matches);
      const onResize = (): void => {
        const mobile = mediaQuery.matches;
        this.isMobileView.set(mobile);
        this.applyResponsiveCalendarView(mobile);
      };
      mediaQuery.addEventListener('change', onResize);
      this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onResize));
    }
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      if (this.isMobileView()) {
        void this.refreshVerticalListEvents();
      } else {
        this.applyResponsiveCalendarView(false);
      }
    });
  }

  get effectiveUserId(): string | undefined {
    return this.userId ?? this.authService.userId() ?? undefined;
  }

  async handleDatesSet(arg: { start: Date; end: Date }): Promise<void> {
    if (!this.effectiveUserId) return;

    if (this.dateFilterActive()) {
      const { fromDate, toDate } = this.dateFilterForm.getRawValue();
      await this.loadEvents(fromDate, toDate);
      return;
    }

    const { fromDate, toDate } = calendarViewRangeInclusive(arg.start, arg.end);
    await this.loadEvents(fromDate, toDate);
  }

  async applyDateFilter(): Promise<void> {
    if (this.dateFilterForm.invalid) {
      this.dateFilterForm.markAllAsTouched();
      return;
    }

    const { fromDate, toDate } = this.dateFilterForm.getRawValue();
    if (fromDate > toDate) {
      this.dateFilterError.set(this.i18n.t('calendar.error.dateFilterRange'));
      return;
    }

    this.dateFilterError.set(null);
    this.dateFilterActive.set(true);

    if (this.isMobileView()) {
      this.mobileListMode.set('list');
    }

    await this.loadEvents(fromDate, toDate);

    const sameMonth = fromDate.slice(0, 7) === toDate.slice(0, 7);
    if (sameMonth && !this.isMobileView()) {
      this.applyDateFilterToCalendar(fromDate, toDate);
      this.calendarComponent?.getApi()?.render();
    }
  }

  clearDateFilter(): void {
    this.dateFilterActive.set(false);
    this.dateFilterError.set(null);
    this.initDateFilterDefaults();

    if (this.isMobileView()) {
      this.mobileListMode.set('month');
      this.mobileListAnchor.set(todayDateOnly());
      void this.refreshVerticalListEvents();
      return;
    }

    const api = this.calendarComponent?.getApi();
    if (api) {
      api.setOption('visibleRange', undefined);
      api.setOption('validRange', undefined);
      api.setOption('headerToolbar', { ...this.defaultHeaderToolbar });
      api.changeView('dayGridMonth');
      api.today();
    }
  }

  openDatePicker(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement && typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        /* browser may block if not from user gesture — ignore */
      }
    }
  }

  dateFilterActiveLabel(): string {
    const { fromDate, toDate } = this.dateFilterForm.getRawValue();
    return this.i18n.t('calendar.filter.active', {
      from: this.formatDate(fromDate),
      to: this.formatDate(toDate),
    });
  }

  dateFilterSpansMonths(): boolean {
    if (!this.dateFilterActive()) return false;
    const { fromDate, toDate } = this.dateFilterForm.getRawValue();
    return fromDate.slice(0, 7) !== toDate.slice(0, 7);
  }

  showVerticalDayList(): boolean {
    return this.isMobileView() || (this.dateFilterActive() && this.dateFilterSpansMonths());
  }

  verticalDayGroups(): { date: string; events: CalendarEvent[] }[] {
    const { fromDate, toDate } = this.getVerticalListRange();
    return this.buildDayGroupsForRange(fromDate, toDate, this.events());
  }

  todayDate(): string {
    return todayDateOnly();
  }

  formatVerticalDayHeading(iso: string): string {
    return formatWeekdayDisplayDate(iso, this.i18n.dateLocale());
  }

  mobileListTitle(): string {
    const { fromDate, toDate } = this.getVerticalListRange();
    if (this.mobileListMode() === 'month') {
      return new Intl.DateTimeFormat(this.i18n.dateLocale(), {
        month: 'long',
        year: 'numeric',
      }).format(toLocalDate(fromDate));
    }
    return `${this.formatDate(fromDate)} – ${this.formatDate(toDate)}`;
  }

  showMobileListNavControls(): boolean {
    return this.mobileListMode() === 'week' || this.mobileListMode() === 'month';
  }

  onMobileFilterRangeChange(): void {
    if (!this.isMobileView() || this.dateFilterActive()) return;
    if (this.mobileListMode() === 'list') {
      void this.refreshVerticalListEvents();
    }
  }

  shiftMobileList(direction: -1 | 1): void {
    if (this.mobileListMode() === 'list') return;

    const anchor = toLocalDate(this.mobileListAnchor());
    if (this.mobileListMode() === 'month') {
      anchor.setMonth(anchor.getMonth() + direction);
    } else {
      anchor.setDate(anchor.getDate() + direction * 7);
    }
    this.mobileListAnchor.set(toDateOnly(anchor));
    void this.refreshVerticalListEvents();
  }

  mobileListGoToday(): void {
    this.mobileListAnchor.set(todayDateOnly());
    void this.refreshVerticalListEvents();
  }

  setMobileListMode(mode: 'week' | 'month' | 'list'): void {
    if (this.mobileListMode() === mode) return;
    if (mode !== 'list' && this.dateFilterActive()) {
      this.dateFilterActive.set(false);
      this.dateFilterError.set(null);
    }
    this.mobileListMode.set(mode);
    void this.refreshVerticalListEvents();
  }

  private getVerticalListRange(): { fromDate: string; toDate: string } {
    if (this.dateFilterActive() || this.mobileListMode() === 'list') {
      return this.dateFilterForm.getRawValue();
    }
    return this.mobileListRange();
  }

  private mobileListRange(): { fromDate: DateOnly; toDate: DateOnly } {
    const anchor = toLocalDate(this.mobileListAnchor());
    if (this.mobileListMode() === 'month') {
      const year = anchor.getFullYear();
      const month = anchor.getMonth() + 1;
      const monthStr = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      return {
        fromDate: `${year}-${monthStr}-01`,
        toDate: `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`,
      };
    }

    const day = anchor.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = addDays(anchor, mondayOffset);
    const sunday = addDays(monday, 6);
    return { fromDate: toDateOnly(monday), toDate: toDateOnly(sunday) };
  }

  private buildDayGroupsForRange(
    fromDate: string,
    toDate: string,
    events: CalendarEvent[],
  ): { date: string; events: CalendarEvent[] }[] {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const date = event.start.slice(0, 10);
      const bucket = map.get(date) ?? [];
      bucket.push(event);
      map.set(date, bucket);
    }

    const groups: { date: string; events: CalendarEvent[] }[] = [];
    let cursor: DateOnly = fromDate;
    while (cursor <= toDate) {
      groups.push({ date: cursor, events: map.get(cursor) ?? [] });
      cursor = addDaysToDateOnly(cursor, 1);
    }
    return groups;
  }

  private async refreshVerticalListEvents(): Promise<void> {
    if (!this.showVerticalDayList()) return;
    const { fromDate, toDate } = this.getVerticalListRange();
    await this.loadEvents(fromDate, toDate);
  }

  formatEventTimeRange(event: CalendarEvent): string {
    const startTime = event.start.includes('T') ? event.start.slice(11, 16) : '';
    const endTime = event.end.includes('T') ? event.end.slice(11, 16) : '';
    if (startTime && endTime) return `${startTime} – ${endTime}`;
    return startTime || '';
  }

  async openFilteredEvent(event: CalendarEvent): Promise<void> {
    await this.openEventDetail(event);
  }

  async loadEvents(fromDate: string, toDate: string): Promise<void> {
    const userId = this.effectiveUserId;
    if (!userId) return;

    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const { events } = await this.spacedRepetitionService.loadCalendarRange(
        userId,
        fromDate,
        toDate,
      );
      const clipped = this.clipEventsToRange(events, fromDate, toDate);
      this.events.set(clipped);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  handleDateClick(arg: DateClickArg): void {
    if (this.readOnly) return;

    const clickedDate = toDateOnly(arg.date);

    if (this.isMobileView()) {
      this.openDailyEvents(clickedDate);
      return;
    }

    this.openCreateTopic(clickedDate);
  }

  openDailyEvents(dateISO: string): void {
    const dayEvents = this.events().filter((event) => event.start.startsWith(dateISO));
    this.selectedDate.set(dateISO);
    this.dailyEvents.set(dayEvents);
    this.modalMode.set('daily-events');
  }

  openCreateTopic(dateISO: string): void {
    this.selectedDate.set(dateISO);
    this.topicForm.reset({
      title: '',
      study_date: dateISO,
      subject: '',
      notes: '',
      resource_url: '',
      study_start_time: DEFAULT_STUDY_START_TIME,
      study_end_time: DEFAULT_STUDY_END_TIME,
      reminder_time: DEFAULT_TOPIC_REMINDER_TIME,
    });
    this.modalMode.set('create-topic');
  }

  async openDailyEventItem(event: CalendarEvent): Promise<void> {
    this.modalMode.set(null);
    await this.openEventDetail(event);
  }

  async openEventDetailFromProps(
    eventType: CalendarEventType,
    topicId: string,
    reviewId?: string,
  ): Promise<void> {
    this.selectedEventType.set(eventType);
    this.selectedReview.set(null);
    this.scheduleError.set(null);

    const topic = await this.studyTopicService.getTopicById(topicId);
    this.selectedTopic.set(topic);
    this.initCurrentStep(topic);

    if (eventType === CalendarEventType.REVIEW && reviewId) {
      const review = topic?.study_reviews?.find((r) => r.id === reviewId) ?? null;
      this.selectedReview.set(review);
      this.modalMode.set('review-detail');
    } else {
      this.modalMode.set('topic-detail');
    }
  }

  private async openEventDetail(event: CalendarEvent): Promise<void> {
    const { eventType, topicId, reviewId } = event.extendedProps;
    await this.openEventDetailFromProps(eventType, topicId, reviewId);
  }

  renderEventContent(arg: EventContentArg): { domNodes: HTMLElement[] } {
    const props = arg.event.extendedProps;
    const icon = props['icon'] as CalendarEventIcon;
    const topicId = props['topicId'] as string;
    const fullLabel = this.buildEventFullLabel(arg);
    const compact = this.isMobileView() && arg.view.type === 'dayGridMonth';
    const root = document.createElement('div');
    root.className = `sr-event sr-event--topic sr-event--${icon}${compact ? ' sr-event--compact' : ''}`;
    root.setAttribute('title', fullLabel);
    applyTopicColorStyles(root, topicId);

    if (!compact) {
      const iconEl = document.createElement('span');
      iconEl.className = 'sr-event__icon';
      iconEl.textContent = this.getEventIconChar(icon);
      iconEl.setAttribute('aria-hidden', 'true');
      root.appendChild(iconEl);

      const badgeText = props['badgeText'] as string | undefined;
      const stepLabel = props['stepLabel'] as string | undefined;

      if (badgeText) {
        const badge = document.createElement('span');
        badge.className = 'sr-event__badge';
        badge.textContent = stepLabel ? `${badgeText} · ${stepLabel}` : badgeText;
        root.appendChild(badge);
      }

      const title = document.createElement('span');
      title.className = 'sr-event__title';
      title.textContent = (props['topicTitle'] as string) ?? arg.event.title;
      root.appendChild(title);
    }

    return { domNodes: [root] };
  }

  private buildEventFullLabel(source: EventContentArg): string {
    const props = source.event.extendedProps;
    const topicTitle = (props['topicTitle'] as string) ?? source.event.title;
    const eventType = props['eventType'] as CalendarEventType;
    const badgeText = props['badgeText'] as string | undefined;
    const stepLabel = props['stepLabel'] as string | undefined;

    if (eventType === CalendarEventType.STUDY) {
      return topicTitle;
    }

    const parts = [badgeText, stepLabel, topicTitle].filter(Boolean);
    return parts.join(' · ');
  }

  getEventIconChar(icon: CalendarEventIcon): string {
    switch (icon) {
      case 'study':
        return '📘';
      case 'completed':
        return '✓';
      case 'overdue':
        return '⚠';
      default:
        return '↻';
    }
  }

  getDailyEventIcon(event: CalendarEvent): string {
    return this.getEventIconChar(event.extendedProps.icon);
  }

  getDailyEventBadge(event: CalendarEvent): string {
    const { badgeText, stepLabel } = event.extendedProps;
    if (badgeText && stepLabel) return `${badgeText} · ${stepLabel}`;
    if (badgeText) return badgeText;
    return event.extendedProps.eventType === CalendarEventType.STUDY ? 'STUDY' : 'REVIEW';
  }

  getDailyEventClass(event: CalendarEvent): string {
    return `daily-event-item daily-event-item--topic daily-event-item--${event.extendedProps.icon}`;
  }

  getDailyEventStyle(event: CalendarEvent): Record<string, string> {
    return getTopicColorCssVars(event.extendedProps.topicId);
  }

  getDailyStudyEvents(): CalendarEvent[] {
    return this.dailyEvents().filter((e) => e.extendedProps.eventType === CalendarEventType.STUDY);
  }

  getDailyReviewEvents(): CalendarEvent[] {
    return this.dailyEvents().filter((e) => e.extendedProps.eventType === CalendarEventType.REVIEW);
  }

  formatDailyListDate(iso: string): string {
    return formatLongDisplayDate(iso, this.i18n.dateLocale());
  }

  getDailyEventAriaLabel(event: CalendarEvent): string {
    const { eventType, topicTitle, badgeText, icon } = event.extendedProps;
    if (eventType === CalendarEventType.STUDY) {
      return this.i18n.t('calendar.aria.studySession', { title: topicTitle });
    }
    const stateLabel =
      icon === 'completed'
        ? this.i18n.t('calendar.aria.completed')
        : icon === 'overdue'
          ? this.i18n.t('calendar.aria.overdue')
          : this.i18n.t('calendar.aria.reviewLabel');
    return this.i18n.t('calendar.aria.review', {
      state: stateLabel,
      badge: badgeText ?? '',
      title: topicTitle,
    });
  }

  translateReviewState(review: StudyReview): string {
    switch (this.getReviewUiState(review)) {
      case ReviewUiState.COMPLETED:
        return this.i18n.t('calendar.reviewState.completed');
      case ReviewUiState.TODAY:
        return this.i18n.t('calendar.reviewState.today');
      case ReviewUiState.OVERDUE:
        return this.i18n.t('calendar.reviewState.overdue');
      default:
        return this.i18n.t('calendar.reviewState.upcoming');
    }
  }

  translateReviewStatus(status: ReviewStatus): string {
    return status === ReviewStatus.COMPLETED
      ? this.i18n.t('calendar.reviewStatus.completed')
      : this.i18n.t('calendar.reviewStatus.pending');
  }

  private buildCalendarButtonText() {
    const listLabel = this.i18n.t('calendar.fc.list');
    const monthLabel = this.i18n.t('calendar.fc.month');
    const weekLabel = this.i18n.t('calendar.fc.week');
    return {
      prev: this.i18n.t('calendar.fc.prev'),
      next: this.i18n.t('calendar.fc.next'),
      today: this.i18n.t('calendar.fc.today'),
      month: monthLabel,
      week: weekLabel,
      list: listLabel,
      listWeek: weekLabel,
      listMonth: monthLabel,
      listFilterRange: listLabel,
      dayGridFilterRange: monthLabel,
    };
  }

  private applyCalendarLocale(): void {
    const locale = this.i18n.locale();
    const fcLocale = locale === 'vi' ? 'vi' : 'en';
    const buttonText = this.buildCalendarButtonText();

    this.calendarOptions = {
      ...this.calendarOptions,
      locale: fcLocale,
      buttonText,
    };

    const api = this.calendarComponent?.getApi();
    if (api) {
      api.setOption('locale', fcLocale);
      api.setOption('buttonText', buttonText);
    }
  }

  async handleEventClick(arg: EventClickArg): Promise<void> {
    const eventType = arg.event.extendedProps['eventType'] as CalendarEventType;
    const topicId = arg.event.extendedProps['topicId'] as string;
    const reviewId = arg.event.extendedProps['reviewId'] as string | undefined;
    await this.openEventDetailFromProps(eventType, topicId, reviewId);
  }

  private initCurrentStep(topic: StudyTopic | null): void {
    if (!topic) {
      this.currentStepOffset.set(null);
      return;
    }

    const stored = topic.current_step_offset ?? 0;
    const inferred = this.reviewScheduleService.inferCurrentStepOffset(topic.study_reviews ?? []);
    this.currentStepOffset.set(Math.max(stored, inferred));
  }

  closeModal(): void {
    this.modalMode.set(null);
    this.selectedReview.set(null);
    this.selectedTopic.set(null);
    this.selectedDate.set(null);
    this.selectedEventType.set(null);
    this.dailyEvents.set([]);
    this.currentStepOffset.set(null);
    this.scheduleError.set(null);
  }

  async onCurrentStepChange(offset: number): Promise<void> {
    const topic = this.selectedTopic();
    if (!topic) return;

    this.currentStepOffset.set(offset);
    this.scheduleError.set(null);

    if (!this.readOnly && topic.current_step_offset !== offset) {
      try {
        await this.studyTopicService.updateCurrentStepOffset(topic.id, offset);
        const updated = await this.studyTopicService.getTopicById(topic.id);
        this.selectedTopic.set(updated);
      } catch (err: unknown) {
        this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.saveStep'));
      }
    }
  }

  getCurrentStepOptions(): { offset: number; label: string }[] {
    const topic = this.selectedTopic();
    if (!topic) return [];

    const options: { offset: number; label: string }[] = [
      { offset: 0, label: this.i18n.t('calendar.studyDay') },
    ];

    for (const review of this.getSortedReviews()) {
      options.push({
        offset: review.day_offset,
        label: this.reviewScheduleService.offsetLabel(review.day_offset),
      });
    }

    return options;
  }

  requireCurrentStep(): boolean {
    if (this.currentStepOffset() === null) {
      this.scheduleError.set(this.i18n.t('calendar.currentStep.required'));
      return false;
    }
    return true;
  }

  async submitCreateTopic(): Promise<void> {
    if (this.topicForm.invalid || !this.effectiveUserId) {
      this.topicForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const { title, study_date, subject, notes, resource_url, reminder_time, study_start_time, study_end_time } =
        this.topicForm.getRawValue();
      await this.studyTopicService.createTopic({
        title,
        subject: subject || null,
        description: notes || null,
        resource_url: resource_url || null,
        study_date,
        reminder_time,
        study_start_time,
        study_end_time,
        user_id: this.userId,
      });
      this.closeModal();
      await this.refreshCalendar();
      this.reminderSync.sync();
    } catch (err: unknown) {
      this.errorMessage.set(this.mapTopicError(err, 'calendar.error.createTopic'));
    } finally {
      this.loading.set(false);
    }
  }

  async completeReview(): Promise<void> {
    const review = this.selectedReview();
    if (!review || review.status === ReviewStatus.COMPLETED) return;

    this.loading.set(true);
    try {
      await this.studyReviewService.completeReview(review.id);
      const topic = this.selectedTopic();
      if (topic) {
        await this.onCurrentStepChange(review.day_offset);
      }
      const refreshed = topic ? await this.studyTopicService.getTopicById(topic.id) : null;
      this.selectedTopic.set(refreshed);
      const updatedReview = refreshed?.study_reviews?.find((r) => r.id === review.id) ?? null;
      this.selectedReview.set(updatedReview);
      this.modalMode.set('review-detail');
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.complete'));
    } finally {
      this.loading.set(false);
    }
  }

  openEditTopic(): void {
    const topic = this.selectedTopic();
    if (!topic) return;

    this.editTopicForm.patchValue({
      title: topic.title,
      subject: topic.subject ?? '',
      notes: topic.description ?? '',
      resource_url: topic.resource_url ?? '',
      study_start_time: toTimeInputValue(topic.study_start_time, DEFAULT_STUDY_START_TIME),
      study_end_time: toTimeInputValue(topic.study_end_time, DEFAULT_STUDY_END_TIME),
      reminder_time: this.formatReminderTimeInput(topic.reminder_time),
    });
    this.modalMode.set('edit-topic');
  }

  openEditSchedule(): void {
    if (!this.requireCurrentStep()) return;
    this.scheduleError.set(null);
    this.modalMode.set('edit-schedule');
  }

  backToTopicDetail(): void {
    this.modalMode.set('topic-detail');
    this.scheduleError.set(null);
  }

  backToReviewDetail(): void {
    this.modalMode.set('review-detail');
    this.scheduleError.set(null);
  }

  backFromEditTopic(): void {
    this.modalMode.set(
      this.selectedEventType() === CalendarEventType.REVIEW ? 'review-detail' : 'topic-detail',
    );
  }

  backFromScheduleAction(): void {
    this.modalMode.set('edit-schedule');
  }

  getTopicProgress(): TopicProgress | null {
    const topic = this.selectedTopic();
    const current = this.currentStepOffset();
    if (!topic || current === null) return null;
    return this.topicProgressService.getTopicProgress(topic, current);
  }

  getReviewUiState(review: StudyReview): ReviewUiState {
    return this.topicProgressService.getReviewUiState(review);
  }

  getTotalSteps(): number {
    return this.getSortedReviews().length;
  }

  async submitEditTopic(): Promise<void> {
    const topic = this.selectedTopic();
    if (!topic || this.editTopicForm.invalid) {
      this.editTopicForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    try {
      const { title, subject, notes, resource_url, reminder_time, study_start_time, study_end_time } =
        this.editTopicForm.getRawValue();
      await this.studyTopicService.updateTopic(topic.id, {
        title,
        subject: subject || null,
        description: notes || null,
        resource_url: resource_url || null,
        reminder_time,
        study_start_time,
        study_end_time,
      });
      this.backFromEditTopic();
      const refreshed = await this.studyTopicService.getTopicById(topic.id);
      this.selectedTopic.set(refreshed);
      await this.refreshCalendar();
      this.reminderSync.sync(topic.id);
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.update'));
    } finally {
      this.loading.set(false);
    }
  }

  async deleteTopic(): Promise<void> {
    const topic = this.selectedTopic();
    if (!topic || !confirm(this.i18n.t('calendar.confirm.deleteTopic', { title: topic.title }))) return;

    this.loading.set(true);
    try {
      await this.studyTopicService.deleteTopic(topic.id);
      this.closeModal();
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.delete'));
    } finally {
      this.loading.set(false);
    }
  }

  openAddStep(): void {
    if (!this.requireCurrentStep()) return;

    this.addStepForm.reset({ dayOffset: 20 });
    this.scheduleError.set(null);
    this.modalMode.set('add-step');
  }

  getAddStepPreview(): OffsetPreviewValidation | null {
    const topic = this.selectedTopic();
    const current = this.currentStepOffset();
    if (!topic || current === null) return null;

    const dayOffset = this.addStepForm.controls.dayOffset.value;
    if (!dayOffset) return null;

    return this.reviewScheduleService.validateOffsetPreview({
      reviews: topic.study_reviews ?? [],
      newOffset: dayOffset,
      studyDateISO: topic.study_date,
      currentStepOffset: current,
    });
  }

  async submitAddStep(): Promise<void> {
    const topic = this.selectedTopic();
    const userId = this.effectiveUserId;
    const current = this.currentStepOffset();

    if (!topic || !userId || current === null || this.addStepForm.invalid) {
      this.addStepForm.markAllAsTouched();
      return;
    }

    const dayOffset = this.addStepForm.controls.dayOffset.value;
    const validationError = this.reviewScheduleService.validateNewOffset({
      reviews: topic.study_reviews ?? [],
      newOffset: dayOffset,
      studyDateISO: topic.study_date,
      currentStepOffset: current,
    });

    if (validationError) {
      this.scheduleError.set(validationError);
      return;
    }

    this.loading.set(true);
    this.scheduleError.set(null);

    try {
      await this.studyReviewService.addReviewStep({
        topicId: topic.id,
        dayOffset,
        currentStepOffset: current,
      });
      this.backFromScheduleAction();
      const refreshed = await this.studyTopicService.getTopicById(topic.id);
      this.selectedTopic.set(refreshed);
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.addStep'));
    } finally {
      this.loading.set(false);
    }
  }

  openReplaceStep(review: StudyReview): void {
    if (!this.requireCurrentStep()) return;

    this.selectedReview.set(review);
    this.replaceStepForm.reset({ dayOffset: review.day_offset });
    this.scheduleError.set(null);
    this.modalMode.set('replace-step');
  }

  async submitReplaceStep(): Promise<void> {
    const review = this.selectedReview();
    const topic = this.selectedTopic();
    const current = this.currentStepOffset();

    if (!review || !topic || current === null || this.replaceStepForm.invalid) {
      this.replaceStepForm.markAllAsTouched();
      return;
    }

    const dayOffset = this.replaceStepForm.controls.dayOffset.value;
    const validationError = this.reviewScheduleService.validateReplaceReview(
      review,
      dayOffset,
      topic.study_date,
      topic.study_reviews ?? [],
      current,
    );

    if (validationError) {
      this.scheduleError.set(validationError);
      return;
    }

    this.loading.set(true);
    this.scheduleError.set(null);

    try {
      await this.studyReviewService.replaceReviewStep({
        reviewId: review.id,
        newDayOffset: dayOffset,
        currentStepOffset: current,
      });
      this.backFromScheduleAction();
      const refreshed = await this.studyTopicService.getTopicById(topic.id);
      this.selectedTopic.set(refreshed);
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.replaceStep'));
    } finally {
      this.loading.set(false);
    }
  }

  async deleteFutureStep(review: StudyReview): Promise<void> {
    const current = this.currentStepOffset();
    if (current === null) {
      this.requireCurrentStep();
      return;
    }

    const validationError = this.reviewScheduleService.validateDeleteReview(review, current);
    if (validationError) {
      this.scheduleError.set(validationError);
      return;
    }

    if (
      !confirm(
        this.i18n.t('calendar.confirm.deleteStep', {
          label: this.reviewScheduleService.offsetLabel(review.day_offset),
        }),
      )
    ) {
      return;
    }

    this.loading.set(true);
    this.scheduleError.set(null);

    try {
      await this.studyReviewService.removeReviewStep({
        reviewId: review.id,
        currentStepOffset: current,
      });
      const topic = this.selectedTopic();
      if (topic) {
        const refreshed = await this.studyTopicService.getTopicById(topic.id);
        this.selectedTopic.set(refreshed);
      }
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : this.i18n.t('calendar.error.deleteStep'));
    } finally {
      this.loading.set(false);
    }
  }

  formatDate(iso: string): string {
    return formatShortDisplayDate(iso, this.i18n.dateLocale());
  }

  formatReminderTimeInput(dbTime?: string | null): string {
    if (!dbTime) return DEFAULT_TOPIC_REMINDER_TIME;
    return dbTime.slice(0, 5);
  }

  formatReminderTimeDisplay(dbTime?: string | null): string {
    return this.formatReminderTimeInput(dbTime);
  }

  formatStudyTimeRangeDisplay(topic: StudyTopic): string {
    return formatStudyTimeRange(
      topic.study_start_time,
      topic.study_end_time,
      this.i18n.t('app.empty'),
    );
  }

  private studyTimeRangeValidator(control: AbstractControl): ValidationErrors | null {
    const start = control.get('study_start_time')?.value as string | undefined;
    const end = control.get('study_end_time')?.value as string | undefined;
    if (!start || !end) return null;
    return start >= end ? { studyTimeRange: true } : null;
  }

  getSortedReviews(): StudyReview[] {
    return this.selectedTopic()?.study_reviews ?? [];
  }

  isCurrentStep(review: StudyReview): boolean {
    return this.currentStepOffset() === review.day_offset;
  }

  isPastScheduleStep(review: StudyReview): boolean {
    const current = this.currentStepOffset();
    if (current === null) return false;
    return this.reviewScheduleService.isPastStep(review, current);
  }

  canEditStep(review: StudyReview): boolean {
    const current = this.currentStepOffset();
    if (current === null) return false;
    return this.reviewScheduleService.isFutureEditableStep(review, current);
  }

  private async refreshCalendar(): Promise<void> {
    if (this.dateFilterActive()) {
      const { fromDate, toDate } = this.dateFilterForm.getRawValue();
      await this.loadEvents(fromDate, toDate);
      return;
    }

    if (this.showVerticalDayList()) {
      await this.refreshVerticalListEvents();
      return;
    }

    const api = this.calendarComponent?.getApi();
    if (api) {
      const view = api.view;
      const { fromDate, toDate } = calendarViewRangeInclusive(view.activeStart, view.activeEnd);
      await this.loadEvents(fromDate, toDate);
    }
  }

  private initDateFilterDefaults(): void {
    const today = todayDateOnly();
    const { year, month } = parseDateOnly(today);
    const monthStr = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    this.dateFilterForm.patchValue({
      fromDate: `${year}-${monthStr}-01`,
      toDate: `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`,
    });
  }

  private applyDateFilterToCalendar(fromDate: string, toDate: string): void {
    const api = this.calendarComponent?.getApi();
    if (!api) return;

    const dayCount = this.countDaysInclusive(fromDate, toDate);
    const exclusiveEnd = addDaysToDateOnly(toDate, 1);
    const range = { start: fromDate, end: exclusiveEnd };
    const sameMonth = fromDate.slice(0, 7) === toDate.slice(0, 7);
    const existingViews = (api.getOption('views') ?? {}) as Record<string, unknown>;
    const useListOnly = this.isMobileView() || !sameMonth;

    // visibleRange breaks cross-month dayGrid (only first month renders).
    // Use duration spanning the full filter instead.
    api.setOption('visibleRange', undefined);
    api.setOption('views', {
      ...existingViews,
      listFilterRange: {
        type: 'list',
        duration: { days: dayCount },
      },
      dayGridFilterRange: sameMonth
        ? { type: 'dayGridMonth' }
        : { type: 'dayGrid', duration: { days: dayCount } },
    });
    api.setOption('validRange', range);
    api.setOption('headerToolbar', {
      left: 'today',
      center: 'title',
      right: useListOnly ? 'listFilterRange' : 'dayGridFilterRange,listFilterRange',
    });

    const initialView = useListOnly ? 'listFilterRange' : 'dayGridFilterRange';
    api.changeView(initialView, fromDate);
  }

  private applyResponsiveCalendarView(mobile: boolean): void {
    if (mobile) {
      void this.refreshVerticalListEvents();
      return;
    }

    if (this.dateFilterActive() && !this.dateFilterSpansMonths()) {
      const { fromDate, toDate } = this.dateFilterForm.getRawValue();
      this.applyDateFilterToCalendar(fromDate, toDate);
      return;
    }

    const api = this.calendarComponent?.getApi();
    if (!api) return;

    api.setOption('headerToolbar', { ...this.defaultHeaderToolbar });
    const viewType = api.view.type;
    if (viewType.startsWith('list') && !viewType.includes('Filter')) {
      api.setOption('visibleRange', undefined);
      api.setOption('validRange', undefined);
      api.changeView('dayGridMonth');
    }
  }

  private countDaysInclusive(fromDate: DateOnly, toDate: DateOnly): number {
    const from = toLocalDate(fromDate);
    const to = toLocalDate(toDate);
    return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  }

  private clipEventsToRange(
    events: CalendarEvent[],
    fromDate: string,
    toDate: string,
  ): CalendarEvent[] {
    return events.filter((event) => {
      const eventDate = event.start.slice(0, 10);
      return eventDate >= fromDate && eventDate <= toDate;
    });
  }

  private async reloadEventsForLocale(): Promise<void> {
    await this.refreshCalendar();
  }

  private mapTopicError(err: unknown, fallbackKey: 'calendar.error.createTopic'): string {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('profiles') ||
      message.includes('23503') ||
      message.includes('42501') ||
      message.includes('row-level security') ||
      message.includes('study_topics_user_id_fkey')
    ) {
      return this.i18n.t('calendar.error.profileMissing');
    }
    return message || this.i18n.t(fallbackKey);
  }
}
