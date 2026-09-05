/**
 * services/timetableDisplayService.js
 *
 * Resolves the display strings a Timetable period card / Period Detail
 * panel needs — subject title, topic, concept titles — from the real
 * classroom data, never invented placeholder text. Pure, dependency-
 * free (no Firestore import), matching the same reasoning already
 * established in models/Lesson.js: this stays directly unit-testable.
 *
 * A period's SUBJECT is always resolvable from its Timetable slot
 * alone (see services/timetableService.js), independent of any Lesson
 * — the "preloaded subject tag" the product requires, before a lesson
 * plan is ever attached. TOPIC and concept titles only exist once a
 * Lesson (a lesson plan) is attached.
 */

import { getSubjects, getUnitById, findConcept } from './learningRecordService.js';
import { getCanonicalSubjectById } from './subjectIdentityService.js';
import { isDateKeyInRange } from '../utils/dateHelpers.js';

/**
 * This classroom's own LearningSubject record for a canonical
 * subjectId (e.g. "science") — distinct from LearningSubject.id, that
 * record's own generated id. A Timetable slot's subjectId is always
 * the canonical kind (see models/Timetable.js), so this is the join
 * every subject-title/color lookup here actually needs.
 */
export function findLearningSubjectByCanonicalId(classroom, canonicalSubjectId) {
  return getSubjects(classroom).find((subject) => subject.subjectId === canonicalSubjectId) || null;
}

/** The subject strip's own display title — the classroom's own Learning Record title if this subject has been set up there yet, otherwise the canonical registry's title, otherwise the raw id as a last resort (never blank). */
export function resolveSubjectTitle(classroom, canonicalSubjectId) {
  const learningSubject = findLearningSubjectByCanonicalId(classroom, canonicalSubjectId);
  if (learningSubject?.title) return learningSubject.title;
  const canonical = getCanonicalSubjectById(canonicalSubjectId);
  return canonical ? canonical.title : canonicalSubjectId;
}

/** The dominant "Topic" a period's card shows once a lesson plan is attached — the LearningUnit a Lesson's curriculumUnitId points to. Null before a lesson plan is attached, or if that unit can no longer be found. */
export function resolveLessonTopic(classroom, lesson) {
  if (!lesson?.curriculumUnitId) return null;
  return getUnitById(classroom, lesson.curriculumUnitId)?.title || null;
}

/** Every planned concept on a Lesson, resolved to {id, title} pairs in lesson.conceptIds' own order — what the Period Detail's Planned Concepts list renders. Empty array for no lesson / no concepts, never fabricated placeholders. */
export function resolveLessonConcepts(classroom, lesson) {
  if (!lesson) return [];
  return lesson.conceptIds.map((conceptId) => ({
    id: conceptId,
    title: findConcept(classroom, conceptId)?.concept?.title || conceptId,
  }));
}

// ---------------------------------------------------------------------
// Curriculum progression — the Timetable Calendar's per-subject
// curriculum-progress view (Phase — Calendar curriculum progress).
// Both functions below are pure derivations over already-fetched data
// (a Unit and its own Lessons, however those Lessons were obtained —
// see services/plannerRepository.js's getLessonsForUnit()) — neither
// touches Firestore, matching this file's own existing "stays directly
// unit-testable" convention.
// ---------------------------------------------------------------------

/**
 * Derives one curriculum Unit's real teaching progression from its own
 * actual Lessons — never assumed from "the last scheduled period has
 * passed." `lessonsForUnit` must be every Lesson this classroom has
 * ever created with `curriculumUnitId === unit.id` (i.e. the full
 * result of plannerRepository.getLessonsForUnit()), not just whatever
 * happens to be in a currently-visible date range — a Unit's TRUE
 * start/last-taught date can fall outside whatever month is on
 * screen, and this function's own `startDate`/`lastTaughtLessonDate`
 * are exactly that real, unclamped range.
 *
 * `null` for a Unit with no Lessons at all — nothing to report; a
 * Unit a teacher created but never actually taught has no progression.
 *
 * `lastTaughtLessonDate` — deliberately named "last taught LESSON
 * date," not "last activity date" or anything implying completion: a
 * revision/re-teaching Lesson for an already-complete Unit is a real,
 * legitimate Lesson against this same Unit, and pushes this date
 * forward without the Unit having newly "completed" anything.
 *
 * Completion itself reuses the EXACT signal
 * services/learningRecordTeacherService.js's setConceptTaughtStatus()
 * already writes (LearningConcept.status, flipped either by
 * timetableLessonService.js's markConceptsExecuted() or by a direct
 * Learning Record toggle) — never invented from a scheduled date. A
 * Unit with zero concepts is deliberately never "completed": an empty
 * `.every()` over `[]` is vacuously true, which would otherwise
 * falsely mark an empty, never-really-taught Unit complete.
 *
 * `completedDate` — REJECTED equating this with `lastTaughtLessonDate`
 * (an earlier version of this function did exactly that): a Lesson
 * dated after the Unit's real completion — e.g. a Sep 10 revision
 * Lesson for a Unit that actually finished on Sep 4 — would silently
 * report Sep 10 as "when it completed," which is simply wrong, not
 * merely imprecise. This app has no standalone "Unit completed at"
 * timestamp anywhere, so the true completion date is instead
 * reconstructed from the one real, dated signal that exists for it:
 * `Lesson.executedConceptIds` records exactly which concepts were
 * executed on which dated Lesson. The Unit's completion date is the
 * LATEST of each concept's own FIRST-executed date — the date the
 * slowest concept to be taught was finally marked executed, which is
 * the moment the Unit as a whole became complete.
 *
 * This reconstruction is only trustworthy when EVERY one of the
 * Unit's concepts has at least one dated Lesson recording its
 * execution. It can't be, for at least one real path already in this
 * codebase: `learningRecordTeacherService.setConceptTaughtStatus()`
 * can also be called directly from the Learning Record view's taught/
 * not-taught toggle, entirely independent of any Lesson — that path
 * writes no date at all. If any concept's taught status can't be
 * traced back to a dated Lesson here, `completedDate` is honestly
 * `null` even though `isCompleted` is `true` — never a guessed or
 * approximated date. Callers must not fall back to
 * `lastTaughtLessonDate` in that case and call it "completedDate"; if
 * a date must be shown, it should be visibly labeled as the last
 * taught lesson, not the completion date.
 */
export function deriveUnitProgress(unit, lessonsForUnit) {
  const dates = lessonsForUnit.map((lesson) => lesson.date).filter(Boolean).sort();
  if (dates.length === 0) return null;

  const startDate = dates[0];
  const lastTaughtLessonDate = dates[dates.length - 1];
  const periodsCount = lessonsForUnit.length;

  const concepts = unit?.concepts || [];
  const isCompleted = concepts.length > 0 && concepts.every((concept) => concept.status === 'taught');

  let completedDate = null;
  if (isCompleted) {
    const firstExecutedDateByConceptId = new Map();
    lessonsForUnit
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .forEach((lesson) => {
        (lesson.executedConceptIds || []).forEach((conceptId) => {
          if (!firstExecutedDateByConceptId.has(conceptId)) firstExecutedDateByConceptId.set(conceptId, lesson.date);
        });
      });

    const firstExecutedDates = concepts.map((concept) => firstExecutedDateByConceptId.get(concept.id));
    const everyConceptHasADatedExecution = firstExecutedDates.every(Boolean);
    if (everyConceptHasADatedExecution) {
      completedDate = firstExecutedDates.reduce((latest, date) => (date > latest ? date : latest));
    }
  }

  return {
    unitId: unit.id,
    unitTitle: unit.title,
    startDate,
    lastTaughtLessonDate,
    periodsCount,
    isCompleted,
    completedDate, // precise date the Unit became complete, or null if isCompleted but that date can't be reconstructed from dated Lessons (see doc comment above)
  };
}

/**
 * Rolls already-derived per-Unit progress (deriveUnitProgress() above)
 * up into the Calendar's own one-subject, one-month summary — units
 * that COMPLETED within `range` (their own completedDate falls inside
 * it — the Unit may have STARTED long before `range`), units still in
 * progress with any real activity inside `range`, how many teaching
 * periods this subject had inside `range`, and the resulting average
 * periods-per-unit — computed only over units that completed within
 * `range`, since an in-progress Unit's own period count is still
 * growing and averaging it in would understate real pace. `null`
 * (never `0`/`NaN`) when there is nothing to average, so the caller
 * can omit the line entirely rather than showing a manufactured "0".
 *
 * A completed Unit whose own `completedDate` is `null` (deriveUnitProgress()
 * couldn't reconstruct exactly when it completed — see that function's
 * own doc comment) is deliberately excluded from BOTH `completedInRange`
 * and `inProgressInRange` here: it isn't "in progress" (it IS
 * complete), but attributing it to this specific month's completed
 * count would claim a precision this data doesn't actually have. It
 * still appears in the full per-Unit progression list elsewhere,
 * honestly labeled — it's only excluded from this month-bucketed count.
 *
 * `monthLessonsForSubject` — every Lesson inside `range` whose own
 * TeachingSlot's subject matches the one being summarized (the exact
 * same Lessons the Calendar's per-day dots already read from — no
 * second fetch for this).
 */
export function summarizeUnitProgressForRange(unitProgressList, monthLessonsForSubject, range) {
  const unitIdsThisRange = new Set(monthLessonsForSubject.map((lesson) => lesson.curriculumUnitId));

  const completedInRange = unitProgressList.filter((unit) => unit.isCompleted && unit.completedDate && isDateKeyInRange(unit.completedDate, range));
  const inProgressInRange = unitProgressList.filter((unit) => !unit.isCompleted && unitIdsThisRange.has(unit.unitId));

  const averagePeriodsPerCompletedUnit =
    completedInRange.length > 0
      ? completedInRange.reduce((sum, unit) => sum + unit.periodsCount, 0) / completedInRange.length
      : null;

  return {
    completedInRange,
    inProgressInRange,
    teachingPeriodsInRange: monthLessonsForSubject.length,
    averagePeriodsPerCompletedUnit,
  };
}

// ---------------------------------------------------------------------
// Calendar Unit strips — the integrated month-calendar curriculum-
// progression layer (ui/views/TimetableView.js's own
// renderCalendarProgressionWeeks()). Both functions are pure position/
// overlap math over already-derived Unit progress (deriveUnitProgress()
// above) — no new data, no Firestore, matching this file's own
// existing convention.
// ---------------------------------------------------------------------

const dayOfMonthIndex = (dateKey) => Number(dateKey.split('-')[2]) - 1;

/**
 * A simple, deterministic lane assignment so overlapping Units (the
 * data model genuinely permits interleaved Units for the same
 * subject) render on separate horizontal rows instead of colliding —
 * classic greedy interval-graph coloring, not a general-purpose Gantt
 * layout engine. Computed ONCE per month across every relevant Unit
 * (never per calendar week), specifically so the SAME Unit lands in
 * the same lane in every week it appears in — the visual continuity
 * that makes a multi-week strip read as one continuing Unit rather
 * than an unrelated reshuffle each row.
 *
 * Units are processed in start-date order (ties broken by input
 * order, stable) — deterministic and independent of the order
 * `unitProgressList` itself happens to be in. Each Unit's own
 * start/end is clipped to `range` first, so lane decisions only ever
 * reflect what's actually visible in the currently-displayed month.
 *
 * Returns `Map<unitId, laneIndex>` (0-based) — the caller
 * (renderCalendarProgressionWeeks()) still remaps these to a locally
 * compact row index per week (only the lanes actually active that
 * week), so a week with a "gap" lane never wastes empty grid rows.
 */
export function assignUnitLanes(unitProgressList, range) {
  const laneByUnitId = new Map();
  const laneEndColumns = []; // laneEndColumns[i] = the day-of-month index of the last segment placed in lane i

  const sorted = [...unitProgressList].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  sorted.forEach((unit) => {
    const effectiveEnd = unit.completedDate || unit.lastTaughtLessonDate;
    const clippedStart = unit.startDate < range.start ? range.start : unit.startDate;
    const clippedEnd = effectiveEnd > range.end ? range.end : effectiveEnd;
    const startColumn = dayOfMonthIndex(clippedStart);
    const endColumn = dayOfMonthIndex(clippedEnd);

    let laneIndex = laneEndColumns.findIndex((laneEndColumn) => laneEndColumn < startColumn);
    if (laneIndex === -1) {
      laneIndex = laneEndColumns.length;
      laneEndColumns.push(endColumn);
    } else {
      laneEndColumns[laneIndex] = endColumn;
    }
    laneByUnitId.set(unit.unitId, laneIndex);
  });

  return laneByUnitId;
}

/**
 * One Unit's strip segment for a single calendar week — the core
 * positioning math behind the integrated Unit strips. `week` is an
 * array of exactly 7 entries (a real "YYYY-MM-DD" dateKey, or `null`
 * for a leading/trailing blank slot outside the month), in this
 * calendar's own column order — the exact shape
 * ui/views/TimetableView.js's own buildCalendarWeeks() produces.
 * Returns `null` when this Unit has no overlap with this week at all.
 *
 * `startColumn`/`endColumn` are 0-based indexes INTO `week` (0 = this
 * week's first column .. 6 = its last) — directly usable as CSS grid-
 * column placement; never a plain weekday number, since a week's
 * first real column can itself be non-zero (a month's opening week).
 *
 * `continuesBefore`/`continuesAfter` say whether THIS week's segment
 * is a real start/end or a continuation — a Unit that started in an
 * earlier week (or an earlier month) gets `continuesBefore: true`
 * here, and an in-progress Unit (or one whose real span reaches past
 * this week) gets `continuesAfter: true` — both must render with no
 * rounded cap on that edge, so a Unit spanning a week or month
 * boundary never falsely looks like it started/ended there.
 */
export function computeUnitWeekSegment(unit, week) {
  const realDatesInWeek = week.filter(Boolean);
  if (realDatesInWeek.length === 0) return null;

  const weekStart = realDatesInWeek[0];
  const weekEnd = realDatesInWeek[realDatesInWeek.length - 1];
  const effectiveEnd = unit.completedDate || unit.lastTaughtLessonDate;
  if (unit.startDate > weekEnd || effectiveEnd < weekStart) return null;

  const segmentStart = unit.startDate > weekStart ? unit.startDate : weekStart;
  const segmentEnd = effectiveEnd < weekEnd ? effectiveEnd : weekEnd;

  return {
    startColumn: week.indexOf(segmentStart),
    endColumn: week.indexOf(segmentEnd),
    continuesBefore: unit.startDate < segmentStart,
    continuesAfter: effectiveEnd > segmentEnd || !unit.isCompleted,
  };
}
