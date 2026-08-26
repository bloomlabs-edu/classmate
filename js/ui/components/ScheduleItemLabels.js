/**
 * ui/components/ScheduleItemLabels.js
 *
 * Phase U — the one shared "this is a scheduled lesson" visual
 * contract, reused everywhere a timetable occurrence is shown: the
 * Timetable grid's own period cards (ui/views/TimetableView.js) and
 * the compact Today's Schedule widget
 * (ui/components/TodaysScheduleWidget.js) previously built their own,
 * separately-styled subject/topic markup — same underlying data
 * (services/timetableDisplayService.js), two different looks, which
 * read as two different scheduling systems. These two small element
 * factories are now the only place that markup is created, so every
 * caller renders byte-identical subject-badge and topic/"+ Attach
 * lesson" elements — visual consistency by construction, not by
 * convention.
 *
 * Deliberately just two tiny DOM factories, not a bigger "ScheduleItem
 * card" component — each caller (grid cell vs. compact row) still owns
 * its own layout/spacing/extra info (concept counts, carried-forward
 * badges, status pills), which legitimately differ by context. Only
 * the subject badge and the topic/attach-lesson label themselves needed
 * to be identical.
 */

/** The colored subject pill — same `.timetable-period-card__subject` class/markup everywhere, so its background tint, text color, padding, and pill shape never drift between views. */
export function renderSubjectBadge(subjectTitle, color) {
  const badge = document.createElement('span');
  badge.className = 'timetable-period-card__subject';
  badge.style.background = color.tint;
  badge.style.color = color.text;
  badge.textContent = subjectTitle.toUpperCase();
  return badge;
}

/**
 * The lesson title, or — when no lesson is attached yet — the subtle
 * "+ Attach lesson" prompt (see TimetableView.js's own Phase T fix:
 * this must never render bold/prominent, matching
 * `.timetable-period-card__topic--empty`). `topic` is the real,
 * already-resolved title (see timetableDisplayService.resolveLessonTopic())
 * or null — this function never invents one.
 */
export function renderLessonTopicLabel(topic) {
  const topicEl = document.createElement('span');
  topicEl.className = 'timetable-period-card__topic';
  topicEl.textContent = topic || '+ Attach lesson';
  if (!topic) topicEl.classList.add('timetable-period-card__topic--empty');
  return topicEl;
}
