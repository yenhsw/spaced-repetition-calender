import {
  Component,
  DestroyRef,
  Input,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CalendarOptions, EventClickArg, EventContentArg, MoreLinkArg } from '@fullcalendar/core';
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
import { ReviewScheduleService } from '../../../core/services/review-schedule.service';
import { CalendarEvent, CalendarEventIcon } from '../../../core/models/calendar-event.model';
import { StudyReview } from '../../../core/models/study-review.model';
import { StudyTopic } from '../../../core/models/study-topic.model';
import { CalendarEventType } from '../../../core/enums/calendar-event-type.enum';
import { ReviewStatus } from '../../../core/enums/review-status.enum';
import { ReviewUiState } from '../../../core/enums/review-ui-state.enum';
import { OffsetPreviewValidation } from '../../../core/services/review-schedule.service';
import { TopicProgressService } from '../../../core/services/topic-progress.service';
import { TopicProgress } from '../../../core/models/topic-progress.model';
import { ScheduleTimelineComponent } from '../../../shared/components/schedule-timeline/schedule-timeline.component';
import {
  calendarViewRangeInclusive,
  formatLongDisplayDate,
  formatShortDisplayDate,
  toDateOnly,
} from '../../../core/utils/date.utils';

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

@Component({
  selector: 'app-study-calendar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FullCalendarModule, ScheduleTimelineComponent],
  templateUrl: './study-calendar.component.html',
  styleUrl: './study-calendar.component.scss',
})
export class StudyCalendarComponent implements OnInit {
  @Input() userId?: string;
  @Input() readOnly = false;

  @ViewChild(FullCalendarComponent) calendarComponent!: FullCalendarComponent;

  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);
  private readonly studyTopicService = inject(StudyTopicService);
  private readonly studyReviewService = inject(StudyReviewService);
  private readonly spacedRepetitionService = inject(SpacedRepetitionService);
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

  protected readonly topicForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    study_date: ['', Validators.required],
    subject: [''],
    notes: [''],
    resource_url: [''],
  });

  protected readonly editTopicForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    subject: [''],
    notes: [''],
    resource_url: [''],
  });

  protected readonly addStepForm = this.fb.nonNullable.group({
    dayOffset: [20, [Validators.required, Validators.min(1)]],
  });

  protected readonly replaceStepForm = this.fb.nonNullable.group({
    dayOffset: [20, [Validators.required, Validators.min(1)]],
  });

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, interactionPlugin, listPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,listWeek',
    },
    buttonText: {
      prev: 'Previous',
      next: 'Next',
      today: 'Today',
      month: 'Month',
      list: 'List',
    },
    locales: [viLocale],
    locale: 'vi',
    height: 'auto',
    navLinks: true,
    editable: false,
    selectable: false,
    weekends: true,
    dayMaxEvents: 2,
    eventDisplay: 'block',
    eventContent: (arg: EventContentArg) => this.renderEventContent(arg),
    moreLinkClick: (info: MoreLinkArg) => {
      if (this.isMobileView()) {
        this.openDailyEvents(toDateOnly(info.date));
        return 'none';
      }
      return 'popover';
    },
    dateClick: this.handleDateClick.bind(this),
    eventClick: this.handleEventClick.bind(this),
    datesSet: this.handleDatesSet.bind(this),
  };

  ngOnInit(): void {
    if (!this.effectiveUserId) {
      this.errorMessage.set('Không xác định được user.');
    }

    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(max-width: 767px)');
      this.isMobileView.set(mediaQuery.matches);
      const onResize = (): void => this.isMobileView.set(mediaQuery.matches);
      mediaQuery.addEventListener('change', onResize);
      this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onResize));
    }
  }

  get effectiveUserId(): string | undefined {
    return this.userId ?? this.authService.userId() ?? undefined;
  }

  async handleDatesSet(arg: { start: Date; end: Date }): Promise<void> {
    if (!this.effectiveUserId) return;

    const { fromDate, toDate } = calendarViewRangeInclusive(arg.start, arg.end);
    await this.loadEvents(fromDate, toDate);
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
      this.events.set(events);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Không tải được lịch');
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
    const dayEvents = this.events().filter((event) => event.start === dateISO);
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
    const compact = this.isMobileView() && arg.view.type === 'dayGridMonth';
    const root = document.createElement('div');
    root.className = `sr-event sr-event--${icon}${compact ? ' sr-event--compact' : ''}`;

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
    return `daily-event-item daily-event-item--${event.extendedProps.icon}`;
  }

  getDailyStudyEvents(): CalendarEvent[] {
    return this.dailyEvents().filter((e) => e.extendedProps.eventType === CalendarEventType.STUDY);
  }

  getDailyReviewEvents(): CalendarEvent[] {
    return this.dailyEvents().filter((e) => e.extendedProps.eventType === CalendarEventType.REVIEW);
  }

  formatDailyListDate(iso: string): string {
    return formatLongDisplayDate(iso);
  }

  getDailyEventAriaLabel(event: CalendarEvent): string {
    const { eventType, topicTitle, badgeText, icon } = event.extendedProps;
    if (eventType === CalendarEventType.STUDY) {
      return `Study session: ${topicTitle}`;
    }
    const stateLabel =
      icon === 'completed' ? 'Completed' : icon === 'overdue' ? 'Overdue' : 'Review';
    return `${stateLabel} ${badgeText ?? ''} for ${topicTitle}`.trim();
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
        this.scheduleError.set(err instanceof Error ? err.message : 'Không lưu được Current Step');
      }
    }
  }

  getCurrentStepOptions(): { offset: number; label: string }[] {
    const topic = this.selectedTopic();
    if (!topic) return [];

    const options: { offset: number; label: string }[] = [
      { offset: 0, label: 'STUDY (N)' },
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
      this.scheduleError.set('Please select your Current Step before editing the schedule.');
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
      const { title, study_date, subject, notes, resource_url } = this.topicForm.getRawValue();
      await this.studyTopicService.createTopic({
        title,
        subject: subject || null,
        description: notes || null,
        resource_url: resource_url || null,
        study_date,
        user_id: this.userId,
      });
      this.closeModal();
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Tạo topic thất bại');
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
      this.scheduleError.set(err instanceof Error ? err.message : 'Complete thất bại');
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
      const { title, subject, notes, resource_url } = this.editTopicForm.getRawValue();
      await this.studyTopicService.updateTopic(topic.id, {
        title,
        subject: subject || null,
        description: notes || null,
        resource_url: resource_url || null,
      });
      this.backFromEditTopic();
      const refreshed = await this.studyTopicService.getTopicById(topic.id);
      this.selectedTopic.set(refreshed);
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : 'Cập nhật thất bại');
    } finally {
      this.loading.set(false);
    }
  }

  async deleteTopic(): Promise<void> {
    const topic = this.selectedTopic();
    if (!topic || !confirm(`Xóa topic "${topic.title}" và toàn bộ lịch ôn?`)) return;

    this.loading.set(true);
    try {
      await this.studyTopicService.deleteTopic(topic.id);
      this.closeModal();
      await this.refreshCalendar();
    } catch (err: unknown) {
      this.scheduleError.set(err instanceof Error ? err.message : 'Xóa thất bại');
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
      this.scheduleError.set(err instanceof Error ? err.message : 'Thêm step thất bại');
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
      this.scheduleError.set(err instanceof Error ? err.message : 'Thay thế step thất bại');
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
        `Remove ${this.reviewScheduleService.offsetLabel(review.day_offset)} from this topic's review schedule?`,
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
      this.scheduleError.set(err instanceof Error ? err.message : 'Xóa step thất bại');
    } finally {
      this.loading.set(false);
    }
  }

  formatDate(iso: string): string {
    return formatShortDisplayDate(iso);
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
    const api = this.calendarComponent?.getApi();
    if (api) {
      const view = api.view;
      const { fromDate, toDate } = calendarViewRangeInclusive(view.activeStart, view.activeEnd);
      await this.loadEvents(fromDate, toDate);
    }
  }
}
