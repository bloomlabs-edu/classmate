/**
 * services/scorecardService.js
 *
 * The Scorecard — a read-only, aggregated view of a teacher's students'
 * performance across every subject in ONE exam cycle (e.g. "Quarterly
 * Examinations — English/Maths/Science/Social Science"), all in one
 * table. Deliberately a DERIVED view, never a stored one: nothing here
 * writes anything, and no scorecard-specific mark/record is ever
 * persisted — every number shown is computed fresh, each render, from
 * the same models/Assessment.js records the individual Assessment
 * Gradebook itself already owns (see services/assessmentService.js).
 * This keeps there being exactly one place marks actually live.
 *
 * TIMETABLE = scheduling, LEARNING ACTIVITIES = subject eligibility,
 * ASSESSMENT = marks/configuration — this file adds no new concept on
 * top of those three; it only assembles an existing-data view across
 * more than one Assessment at once. Subject scope reuses
 * services/assessmentTimetableLinkService.js's own
 * getSurfaceableExamAssessments() directly — the exact same
 * Learning-Activities gate the "Scheduled from Timetable" list on
 * ui/views/AssessmentManagementView.js's home step already enforces
 * (a Physical Education exam never appears here for the same reason it
 * never appears there: PE has no matching LearningSubject unless the
 * classroom has actually added it to Learning Record/Learning
 * Activities).
 *
 * CYCLE GROUPING — the one real design decision this file makes: a
 * "cycle" is a set of exam-type ScheduledEvents sharing the exact same
 * `title` string (services/scheduledEventService.js's own
 * groupEventsByTitle(), unchanged, no second grouping invented). This
 * is deliberately narrower than "every Assessment with a matching
 * title" — two independently, manually created Assessments that happen
 * to share a title (e.g. two unrelated "Mid Term" entries) are NOT
 * reliably the same cycle, and this file never assumes they are. Only
 * ScheduledEvent-linked Assessments (a real, explicit
 * `scheduledEventId` relationship — see models/Assessment.js's own
 * header comment) ever appear in a Scorecard cycle; a manually created,
 * unlinked Assessment (e.g. "1st Mid Term") has no cycle to belong to
 * and is out of scope for this version, exactly because the data model
 * has no reliable relationship connecting it to any other Assessment.
 */

import { groupEventsByTitle } from './scheduledEventService.js';
import { getSurfaceableExamAssessments } from './assessmentTimetableLinkService.js';
import * as assessmentService from './assessmentService.js';

/**
 * Every exam cycle with at least one Learning-Activities-eligible
 * subject — the Scorecard's own cycle-picker list. `examEvents` must
 * already be filtered to `eventType: 'exam'` (same contract as
 * getSurfaceableExamAssessments() itself). A cycle whose every event's
 * subject is NOT in Learning Activities (the all-PE case) is silently
 * excluded — same "never surface what the teacher has no access to"
 * rule as everywhere else in this feature.
 *
 * Returns `[{ cycleKey, title, items }]` — `items` is exactly
 * getSurfaceableExamAssessments()'s own return shape
 * (`{ event, learningSubject, subjectTitle, linkedAssessment }`),
 * scoped to this one cycle. `cycleKey` is the group's own `title`,
 * used verbatim as the route param (see ui/router.js's own
 * `assessmentsScorecard` route) — the only natural, already-existing
 * grouping key groupEventsByTitle() provides; no second id invented.
 */
export function getEligibleExamCycles(classroom, examEvents, assessments) {
  return groupEventsByTitle(examEvents)
    .map((group) => ({
      cycleKey: group.title,
      title: group.title,
      items: getSurfaceableExamAssessments(classroom, group.events, assessments),
    }))
    .filter((cycle) => cycle.items.length > 0);
}

/**
 * The actual student-by-subject table for one cycle's own `items`
 * (see getEligibleExamCycles() above). Every subject column is
 * included as long as it's eligible (Learning-Activities gated) and
 * has a ScheduledEvent in this cycle — even one whose Assessment
 * hasn't been "Set up" yet (`linkedAssessment: null`), so the
 * Scorecard honestly shows an expected-but-not-yet-graded subject
 * rather than silently omitting it.
 *
 * AGGREGATION — "Overall %" is `sum(obtained marks) / sum(maximum
 * marks)`, summed ONLY over subjects where THIS student has a usable
 * mark (not absent, not blank) — never a per-subject average of
 * percentages (which would silently equal-weight a /50 subject and a
 * /100 one) and never treating a missing mark as zero (which would
 * incorrectly penalize a student for a subject not yet graded at all).
 * This is the plain, explicitly documented approach the task's own
 * brief asked for when no more elaborate weighting scheme already
 * exists in this codebase — confirmed by inspection: no canonical
 * cross-subject aggregation function existed before this file.
 * `null` (never a fabricated 0%) when the student has no usable mark
 * in ANY subject yet.
 */
export function buildScorecardForCycle(classroom, items) {
  const subjects = items.map((item) => {
    const assessmentSubject = item.linkedAssessment
      ? item.linkedAssessment.assessmentSubjects.find((as) => as.subjectId === item.learningSubject.id) || null
      : null;
    return {
      subjectTitle: item.subjectTitle,
      linkedAssessment: item.linkedAssessment,
      assessmentSubject,
    };
  });

  const students = assessmentService.getClassroomStudents(classroom);

  const rows = students.map((student) => {
    const cells = subjects.map((subject) => {
      const assessmentId = subject.linkedAssessment ? subject.linkedAssessment.id : null;
      if (!subject.assessmentSubject) {
        return { subjectTitle: subject.subjectTitle, marks: null, maximumMarks: null, hasResult: false, assessmentId };
      }
      const result = assessmentService.getStudentResult(subject.assessmentSubject, student.id);
      const hasResult = Boolean(result) && !result.absent && result.marks !== null;
      return {
        subjectTitle: subject.subjectTitle,
        marks: hasResult ? result.marks : null,
        maximumMarks: assessmentService.getMaximumMarks(subject.assessmentSubject),
        hasResult,
        assessmentId,
      };
    });

    const assessedCells = cells.filter((cell) => cell.hasResult);
    const overallObtained = assessedCells.reduce((sum, cell) => sum + cell.marks, 0);
    const overallMaximum = assessedCells.reduce((sum, cell) => sum + cell.maximumMarks, 0);
    const overallPercent = overallMaximum > 0 ? Math.round((overallObtained / overallMaximum) * 1000) / 10 : null;

    return {
      student,
      cells,
      subjectsAssessedCount: assessedCells.length,
      subjectsTotalCount: subjects.length,
      overallPercent,
    };
  });

  return { subjects, rows };
}

/** "English 21/21 assessed" per subject column — how many students on the real roster have a usable mark for that subject yet. Purely informational; never affects the Overall calculation above. */
export function getSubjectAssessedCounts(classroom, subjects) {
  const students = assessmentService.getClassroomStudents(classroom);
  return subjects.map((subject) => {
    if (!subject.assessmentSubject) return { subjectTitle: subject.subjectTitle, assessedCount: 0, totalCount: students.length };
    const assessedCount = students.filter((student) => {
      const result = assessmentService.getStudentResult(subject.assessmentSubject, student.id);
      return Boolean(result) && !result.absent && result.marks !== null;
    }).length;
    return { subjectTitle: subject.subjectTitle, assessedCount, totalCount: students.length };
  });
}

/**
 * "76% Assessed" — the Scorecard header's own summary stat. Sums
 * `assessedCount`/`totalCount` across every subject column (see
 * getSubjectAssessedCounts() above) — the exact same per-
 * (student, subject) counting convention
 * ui/views/AssessmentManagementView.js's own Gradebook header
 * "13/21 Marks Entered" line already uses, reused here rather than a
 * second, differently-defined "assessed" figure. `null` (never a
 * fabricated 0%) when there are no subject columns/students at all to
 * measure.
 */
export function getOverallAssessedPercent(subjectCounts) {
  const totalAssessed = subjectCounts.reduce((sum, count) => sum + count.assessedCount, 0);
  const totalPossible = subjectCounts.reduce((sum, count) => sum + count.totalCount, 0);
  if (totalPossible === 0) return null;
  return Math.round((totalAssessed / totalPossible) * 100);
}
