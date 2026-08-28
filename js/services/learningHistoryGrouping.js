/**
 * services/learningHistoryGrouping.js
 *
 * Phase 5 (Student Learning View) — the pure "what did we learn, and
 * when" grouping/labeling logic behind the student-facing "My
 * Learning" retrospective landing (see
 * ui/student-portal/views/StudentLearningView.js's own 'recent'
 * level). Deliberately dependency-free (only utils/dateHelpers.js,
 * itself dependency-free) so this — the one genuinely new piece of
 * *logic* this phase adds, as opposed to new UI wiring around
 * already-existing data — stays directly unit-testable without
 * pulling in the Firestore SDK, the same reason
 * services/classroomSaveStateMachine.js was split out in Phase 4.
 *
 * Operates on plain "taught day" entries this file knows nothing
 * about the shape of beyond a `date` field ("YYYY-MM-DD", matching
 * utils/dateHelpers.js's own dateKey convention and models/Lesson.js's
 * own `date` field) — the actual entries are built by
 * services/timetableLessonService.js's getRecentlyTaughtLessons() by
 * resolving real Lesson documents against the classroom's Learning
 * Record tree; this file never touches Firestore or the classroom
 * object itself, only arrays already handed to it.
 */

import { getTodayDateKey, shiftDateKey, formatDateKey } from '../utils/dateHelpers.js';
import * as learningRecordService from './learningRecordService.js';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * "Today" / "Yesterday" for the two most recent days, the actual
 * weekday name ("Monday") for anything else within the last 6 days,
 * and a plain formatted date ("22 Jul 2026") beyond that — matching
 * this phase's own approved mockup ("Today" / "Yesterday" / "Monday")
 * without inventing a fourth tier for anything further back than a
 * week, where a weekday name alone stops being unambiguous.
 */
export function getRelativeDayLabel(dateKey, todayDateKey = getTodayDateKey()) {
  if (dateKey === todayDateKey) return 'Today';
  if (dateKey === shiftDateKey(todayDateKey, -1)) return 'Yesterday';

  const [year, month, day] = dateKey.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = todayDateKey.split('-').map(Number);
  const daysAgo = Math.round((new Date(todayYear, todayMonth - 1, todayDay) - new Date(year, month - 1, day)) / 86400000);

  if (daysAgo > 0 && daysAgo < 7) {
    return WEEKDAY_NAMES[new Date(year, month - 1, day).getDay()];
  }
  return formatDateKey(dateKey);
}

/** Newest date first. Stable for entries sharing the same date (their relative order is preserved). */
export function sortByDateDesc(entries) {
  return [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Buckets already-sorted (or not — this sorts first) taught-day
 * entries into one group per calendar date, newest first, each
 * carrying a ready-to-render relative label. ui/student-portal/views/StudentLearningView.js's
 * "Recently Taught" landing truncates the result to its first few
 * groups for a quick scan — "View all learning" is a deliberately
 * separate path (the full curriculum tree, including concepts marked
 * taught without ever going through a dated Lesson at all — see that
 * file's own header comment for why), not simply this same list
 * untruncated.
 */
export function groupByDay(entries, todayDateKey = getTodayDateKey()) {
  const sorted = sortByDateDesc(entries);
  const groups = [];
  const groupByDate = new Map();

  sorted.forEach((entry) => {
    let group = groupByDate.get(entry.date);
    if (!group) {
      group = { dateKey: entry.date, label: getRelativeDayLabel(entry.date, todayDateKey), entries: [] };
      groupByDate.set(entry.date, group);
      groups.push(group);
    }
    group.entries.push(entry);
  });

  return groups;
}

/**
 * The pure half of services/timetableLessonService.js's
 * getRecentlyTaughtLessons() — everything after the actual Firestore
 * fetch. Split out here (rather than left inline in that
 * Firestore-touching file) purely so it's directly unit-testable
 * without pulling in the Firestore SDK, the same reason this whole
 * module exists — see this file's own header comment.
 *
 * Resolves each Lesson's `executedConceptIds` against the classroom's
 * own Learning Record tree, keeping only Lessons where at least one
 * executed concept still resolves (a concept id an occurrence
 * recorded, then later deleted from the syllabus entirely, is the one
 * case skipped — an honest "nothing real left to show," not an
 * error). Concepts within one Lesson always share that Lesson's own
 * `curriculumUnitId`, so the first resolved concept's subject/unit is
 * this whole entry's subject/unit — never re-derived per concept.
 */
export function resolveExecutedLessonEntries(classroom, lessons) {
  return lessons
    .filter((lesson) => lesson.executedConceptIds.length > 0)
    .map((lesson) => {
      const resolvedConcepts = lesson.executedConceptIds
        .map((conceptId) => learningRecordService.findConcept(classroom, conceptId))
        .filter(Boolean);
      if (resolvedConcepts.length === 0) return null;

      const { subject, unit } = resolvedConcepts[0];
      return {
        lessonId: lesson.id,
        date: lesson.date,
        subjectTitle: subject.title,
        unitId: unit.id,
        unitTitle: unit.title,
        concepts: resolvedConcepts.map(({ concept }) => concept),
      };
    })
    .filter(Boolean);
}
