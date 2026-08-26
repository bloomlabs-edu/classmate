/**
 * ui/components/TodaysScheduleWidget.js
 *
 * The compact "Today's Schedule" module for the Teacher Home/Dashboard
 * — per the approved reference, a summary only (time, subject, topic,
 * status), never the full Timetable grid. Reads the exact same real
 * data the Timetable itself does (services/timetableService.js +
 * services/plannerRepository.js) — no dummy periods, no separate
 * "home version" of the schedule.
 *
 * Self-contained async component (same "fire off the async render,
 * fill in the container once data resolves" shape
 * ui/views/TimetableView.js itself uses) so ui/views/DashboardView.js,
 * which renders synchronously, doesn't need to become async itself
 * just to host this one widget.
 */

import * as timetableService from '../../services/timetableService.js';
import * as timetableDisplayService from '../../services/timetableDisplayService.js';
import * as plannerRepository from '../../services/plannerRepository.js';
import { getTimetableSubjectColor } from '../../config/timetableSubjectColors.js';
import { getTodayDateKey } from '../../utils/dateHelpers.js';

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

/** `onViewFullTimetable` navigates to the real Timetable — this widget is a summary, never a replacement for it. */
export async function renderTodaysScheduleWidget(container, { classroom, onViewFullTimetable }) {
  container.className = 'todays-schedule-widget';
  container.innerHTML = '<p class="todays-schedule-widget__loading">Loading today’s schedule…</p>';

  const todayKey = getTodayDateKey();
  const slots = timetableService.getConcreteSlotsForDateRange(classroom, todayKey, todayKey);

  if (slots.length === 0) {
    container.innerHTML = '';
    return; // Nothing configured for today — the widget simply doesn't show, not a fabricated empty state.
  }

  let lessonsByTeachingSlotId = {};
  try {
    const lessons = await plannerRepository.getLessonsForDateRange(classroom.id, todayKey, todayKey);
    lessonsByTeachingSlotId = Object.fromEntries(lessons.map((lesson) => [lesson.teachingSlotId, lesson]));
  } catch (error) {
    console.error('[TodaysScheduleWidget] Failed to load today’s lessons:', error);
  }

  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'todays-schedule-widget__header';
  const title = document.createElement('h3');
  title.textContent = "Today's Schedule";
  header.appendChild(title);
  if (onViewFullTimetable) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'todays-schedule-widget__view-all';
    link.textContent = 'View full timetable';
    link.addEventListener('click', onViewFullTimetable);
    header.appendChild(link);
  }
  container.appendChild(header);

  const now = new Date();
  const list = document.createElement('div');
  list.className = 'todays-schedule-widget__list';

  slots
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .forEach((slot) => {
      const lesson = lessonsByTeachingSlotId[slot.id] || null;
      const color = getTimetableSubjectColor(slot.subjectId);
      const status = resolvePeriodStatus(timetableService.getPeriods(classroom).find((p) => p.periodNumber === slot.periodNumber), lesson, now);

      const row = document.createElement('div');
      row.className = 'todays-schedule-widget__row';

      const time = document.createElement('span');
      time.className = 'todays-schedule-widget__time';
      const period = timetableService.getPeriods(classroom).find((p) => p.periodNumber === slot.periodNumber);
      time.textContent = period.startTime;
      row.appendChild(time);

      const main = document.createElement('div');
      main.className = 'todays-schedule-widget__main';

      const subject = document.createElement('span');
      subject.className = 'todays-schedule-widget__subject';
      subject.style.color = color.text;
      subject.textContent = timetableDisplayService.resolveSubjectTitle(classroom, slot.subjectId).toUpperCase();
      main.appendChild(subject);

      const topic = timetableDisplayService.resolveLessonTopic(classroom, lesson);
      const topicEl = document.createElement('span');
      topicEl.className = 'todays-schedule-widget__topic';
      topicEl.textContent = topic || '+ Attach lesson';
      main.appendChild(topicEl);

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

      list.appendChild(row);
    });

  container.appendChild(list);
}
