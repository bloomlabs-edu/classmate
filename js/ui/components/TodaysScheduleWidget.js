/**
 * ui/components/TodaysScheduleWidget.js
 *
 * The Dashboard's own schedule preview — per explicit product
 * direction, this answers "what is the NEXT relevant timetable
 * activity for me," never a blind "today's calendar date -> today's
 * recurring timetable" read. Every decision about WHICH date to show
 * and WHEN to show it goes through services/schoolCalendarService.js's
 * own resolveDashboardScheduleDate()/getEffectiveScheduleForDate() —
 * the same functions ui/views/TimetableView.js's Week/Day/Calendar
 * views derive from, so this widget can never silently disagree with
 * the real Timetable about what's a holiday, a temporary working day,
 * or a date-specific exam.
 *
 * TIME-AWARENESS, concretely:
 *   - Before/during/between today's own periods -> shows TODAY's
 *     effective schedule ("Today's Schedule").
 *   - At/after today's own last period's end time, OR today is a
 *     non-working day (Holiday, or an ordinary weekend with no
 *     override) -> shows the NEXT working date's effective schedule
 *     instead ("Next Schedule · <date>"), skipping any number of
 *     consecutive non-working dates.
 *
 * SELF-REFRESH: a lightweight, precisely-targeted setTimeout — never a
 * fixed-interval poll — rescheduled after every render to fire exactly
 * at the next period boundary (or local midnight, once there are no
 * more boundaries today), via schoolCalendarService's own
 * computeNextRefreshDelayMs(). `container.isConnected` is checked
 * before each scheduled re-render so a stale timer from a Dashboard the
 * teacher has since navigated away from quietly stops rescheduling
 * itself, rather than trying to update a detached DOM node forever.
 */

import * as timetableService from '../../services/timetableService.js';
import * as timetableDisplayService from '../../services/timetableDisplayService.js';
import * as schoolCalendarService from '../../services/schoolCalendarService.js';
import * as scheduledEventService from '../../services/scheduledEventService.js';
import * as scheduledEventRepository from '../../services/scheduledEventRepository.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import { getTimetableSubjectColor, getTimetableSubjectWash } from '../../config/timetableSubjectColors.js';
import { formatDateKeyWithWeekday } from '../../utils/dateHelpers.js';
import { renderSubjectBadge, renderLessonTopicLabel } from './ScheduleItemLabels.js';

function resolvePeriodStatus(period, lesson, now) {
  if (lesson && lesson.conceptIds.length > 0 && lesson.executedConceptIds.length === lesson.conceptIds.length) {
    return 'Completed';
  }
  const [startHour, startMinute] = period.startTime.split(':').map(Number);
  const [endHour, endMinute] = period.endTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);

  if (now < start) return 'Upcoming';
  if (now >= start && now <= end) return 'In progress';
  // Past the period's own end time: a real, real-time distinction, not
  // a fallback to "Upcoming" (a past period is never upcoming) — a
  // lesson with SOME concepts marked (but not all) is "In progress"
  // in spirit even after time has passed; nothing marked at all and
  // nothing attached is honestly "Not taught," not "Completed."
  if (lesson && lesson.executedConceptIds.length > 0) return 'In progress';
  return 'Not taught';
}

/** Same three-state shape as resolvePeriodStatus() above, simplified for a Scheduled Event — an exam has no concept/taught-status concept of its own, only a time range. */
function resolveEventStatus(event, now) {
  const [startHour, startMinute] = event.startTime.split(':').map(Number);
  const [endHour, endMinute] = event.endTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);

  if (now < start) return 'Upcoming';
  if (now >= start && now <= end) return 'In progress';
  return 'Completed';
}

function renderPeriodRow(classroom, dateKey, period, lessonsByTeachingSlotId, now, onViewFullTimetable) {
  const teachingSlotId = timetableService.buildTeachingSlotId(classroom.id, dateKey, period.periodNumber);
  const lesson = lessonsByTeachingSlotId[teachingSlotId] || null;
  const color = getTimetableSubjectColor(period.subjectId);
  const status = resolvePeriodStatus(period, lesson, now);

  const row = document.createElement('div');
  row.className = 'todays-schedule-widget__row';
  row.style.background = getTimetableSubjectWash(period.subjectId);

  const time = document.createElement('span');
  time.className = 'todays-schedule-widget__time';
  time.textContent = period.startTime;
  row.appendChild(time);

  const main = document.createElement('div');
  main.className = 'todays-schedule-widget__main';
  main.appendChild(renderSubjectBadge(timetableDisplayService.resolveSubjectTitle(classroom, period.subjectId), color));
  main.appendChild(renderLessonTopicLabel(timetableDisplayService.resolveLessonTopic(classroom, lesson)));
  row.appendChild(main);

  const statusEl = document.createElement('span');
  statusEl.className = `todays-schedule-widget__status todays-schedule-widget__status--${status.toLowerCase().replace(' ', '-')}`;
  statusEl.textContent = status;
  row.appendChild(statusEl);

  if (lesson && lesson.executedConceptIds.length > 0) {
    const fraction = document.createElement('span');
    fraction.className = 'todays-schedule-widget__fraction';
    fraction.textContent = `${lesson.executedConceptIds.length}/${lesson.conceptIds.length}`;
    row.appendChild(fraction);
  }

  if (onViewFullTimetable) row.addEventListener('click', onViewFullTimetable);
  return row;
}

/**
 * A Scheduled Event's own row — deliberately NOT reusing
 * renderLessonTopicLabel() (its "+ Attach lesson" fallback makes no
 * sense for an exam, which has no lesson-attach concept at all — per
 * explicit product direction not to force the Lesson hierarchy onto
 * events). Shows the event's own title/type and, where present,
 * subject/room — never Unit/Concept fields, which an event simply
 * doesn't have.
 */
function renderEventRow(classroom, event, now, onViewFullTimetable) {
  const color = getTimetableSubjectColor(event.subjectId);
  const status = resolveEventStatus(event, now);
  const subjectTitle = scheduledEventService.resolveEventSubjectTitle(classroom, event);
  const typeLabel = scheduledEventService.getEventTypeLabel(event.eventType);

  const row = document.createElement('div');
  row.className = 'todays-schedule-widget__row todays-schedule-widget__row--event';
  row.style.background = getTimetableSubjectWash(event.subjectId);

  const time = document.createElement('span');
  time.className = 'todays-schedule-widget__time';
  time.textContent = event.startTime;
  row.appendChild(time);

  const main = document.createElement('div');
  main.className = 'todays-schedule-widget__main';
  main.appendChild(renderSubjectBadge(subjectTitle ? `${subjectTitle} ${typeLabel}` : typeLabel, color));
  const titleEl = document.createElement('span');
  titleEl.className = 'timetable-period-card__topic';
  titleEl.textContent = event.title || typeLabel;
  main.appendChild(titleEl);
  if (event.room) {
    const roomEl = document.createElement('span');
    roomEl.className = 'todays-schedule-widget__room';
    roomEl.textContent = `Room ${event.room}`;
    main.appendChild(roomEl);
  }
  row.appendChild(main);

  const statusEl = document.createElement('span');
  statusEl.className = `todays-schedule-widget__status todays-schedule-widget__status--${status.toLowerCase().replace(' ', '-')}`;
  statusEl.textContent = status;
  row.appendChild(statusEl);

  if (onViewFullTimetable) row.addEventListener('click', onViewFullTimetable);
  return row;
}

function renderSchedule(container, { classroom, dateKey, isToday, schedule, lessonsByTeachingSlotId, now, onViewFullTimetable }) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'todays-schedule-widget__header';
  const title = document.createElement('h3');
  title.textContent = isToday ? "Today's Schedule" : 'Next Schedule';
  header.appendChild(title);
  if (!isToday) {
    const dateLabel = document.createElement('span');
    dateLabel.className = 'todays-schedule-widget__next-date';
    dateLabel.textContent = formatDateKeyWithWeekday(dateKey);
    header.appendChild(dateLabel);
  }
  if (onViewFullTimetable) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'todays-schedule-widget__view-all';
    link.textContent = 'View full timetable';
    link.addEventListener('click', onViewFullTimetable);
    header.appendChild(link);
  }
  container.appendChild(header);

  const list = document.createElement('div');
  list.className = 'todays-schedule-widget__list';

  // A single merged, time-ordered list — periods (skipping any an
  // event has overridden, per services/schoolCalendarService.js's own
  // suppressedByEventId) and events together, so an exam sitting
  // between two ordinary periods reads in its real chronological
  // place, not bolted on at the end.
  const rows = [
    ...schedule.periods.filter((period) => !period.suppressedByEventId).map((period) => ({ kind: 'period', startTime: period.startTime, period })),
    ...schedule.events.map((event) => ({ kind: 'event', startTime: event.startTime, event })),
  ].sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));

  rows.forEach((row) => {
    list.appendChild(
      row.kind === 'event'
        ? renderEventRow(classroom, row.event, now, onViewFullTimetable)
        : renderPeriodRow(classroom, dateKey, row.period, lessonsByTeachingSlotId, now, onViewFullTimetable)
    );
  });

  container.appendChild(list);
}

/** `onViewFullTimetable` navigates to the real Timetable — this widget is a summary, never a replacement for it. */
export async function renderTodaysScheduleWidget(container, { classroom, onViewFullTimetable }) {
  container.className = 'todays-schedule-widget';
  container.innerHTML = '<p class="todays-schedule-widget__loading">Loading schedule…</p>';

  let refreshTimeoutId = null;

  function scheduleNextRefresh(periods, now) {
    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
    const delayMs = schoolCalendarService.computeNextRefreshDelayMs(periods, now);
    refreshTimeoutId = setTimeout(() => {
      if (!container.isConnected) return; // Dashboard no longer showing this widget — stop rescheduling.
      loadAndRenderOnce();
    }, delayMs);
  }

  async function loadAndRenderOnce() {
    const now = new Date();
    const { dateKey, isToday } = schoolCalendarService.resolveDashboardScheduleDate(classroom, { now });

    if (!dateKey) {
      // No working day found within the search horizon at all — a
      // structurally empty/misconfigured Timetable (never fabricated
      // placeholder periods); the widget simply doesn't show, same as
      // the pre-existing "nothing configured" convention.
      container.innerHTML = '';
      return;
    }

    let eventsForDate = [];
    try {
      const events = await scheduledEventRepository.getScheduledEventsForDateRange(classroom.id, dateKey, dateKey);
      eventsForDate = scheduledEventService.getEventsForDate(events, dateKey);
    } catch (error) {
      console.error('[TodaysScheduleWidget] Failed to load scheduled events:', error);
    }

    const schedule = schoolCalendarService.getEffectiveScheduleForDate(classroom, dateKey, eventsForDate);

    if (schedule.periods.length === 0 && schedule.events.length === 0) {
      container.innerHTML = '';
      return;
    }

    let lessonsByTeachingSlotId = {};
    try {
      const lessons = await plannerRepository.getLessonsForDateRange(classroom.id, dateKey, dateKey);
      lessonsByTeachingSlotId = Object.fromEntries(lessons.map((lesson) => [lesson.teachingSlotId, lesson]));
    } catch (error) {
      console.error('[TodaysScheduleWidget] Failed to load lessons:', error);
    }

    renderSchedule(container, { classroom, dateKey, isToday, schedule, lessonsByTeachingSlotId, now, onViewFullTimetable });
    // Only today's own boundaries matter for scheduling the next
    // refresh — a future date's own periods aren't "happening" yet, so
    // computeNextRefreshDelayMs() is deliberately given `[]` whenever
    // isToday is false, which its own fallback resolves to "check again
    // at midnight" (the moment that future date's own "is it today yet"
    // question can change).
    scheduleNextRefresh(isToday ? schedule.periods : [], now);
  }

  await loadAndRenderOnce();
}
