/**
 * services/conceptFeedbackService.js
 *
 * Aggregates student feedback per concept and per Lesson, using the
 * EXISTING Learning Record architecture only — Student.learningRecord
 * (see models/StudentConceptRecord.js) and its existing understanding
 * keys (config/learningRecordConfig.js). No second feedback system,
 * no new understanding values.
 *
 * Only EXECUTED concepts are ever included here (see
 * models/Lesson.js's own getFeedbackEligibleConceptIds()) — a planned-
 * but-not-taught concept was never actually presented to students, so
 * it has no feedback to aggregate.
 *
 * Deliberately keeps RESPONSE RATE (how many students said anything at
 * all) and UNDERSTANDING (of those who did, how well) as two separate
 * numbers, per explicit product decision — never collapsed into one
 * combined score.
 */

import { getFeedbackEligibleConceptIds } from '../models/Lesson.js';

/**
 * The two existing UNDERSTANDING_KEYS tiers ('confident', 'can_teach')
 * that count as "reached real understanding" for a positive-percent
 * calculation — matches the reference's own "Got it / Can teach"
 * grouping (see Period Detail's Planned Concepts %, and the Weekly
 * Overview's "Understanding Overview" bars). Never a new value; both
 * already exist in config/learningRecordConfig.js's own UNDERSTANDING_KEYS.
 */
const POSITIVE_UNDERSTANDING_TIERS = ['confident', 'can_teach'];

function getAllStudents(classroom) {
  return (classroom.teams || []).flatMap((team) => team.students || []);
}

function getUnderstanding(student, conceptId) {
  return student.learningRecord?.[conceptId]?.understanding || 'not_marked';
}

/** Response-rate and understanding stats for ONE concept, across every student in the classroom. */
export function getConceptFeedbackStats(classroom, conceptId) {
  const students = getAllStudents(classroom);
  const responses = students.map((student) => getUnderstanding(student, conceptId)).filter((u) => u !== 'not_marked');
  const positiveCount = responses.filter((u) => POSITIVE_UNDERSTANDING_TIERS.includes(u)).length;

  return {
    conceptId,
    totalStudents: students.length,
    respondedCount: responses.length,
    positiveCount,
    positivePercent: responses.length > 0 ? Math.round((positiveCount / responses.length) * 100) : 0,
  };
}

/**
 * Full feedback summary for one Lesson — per-concept stats (executed
 * concepts only), how many distinct students responded to at least one
 * of them, an overall understanding percentage (the average of each
 * executed concept's own positivePercent — matches the reference's
 * single "Overall Understanding" ring being one number derived from
 * several per-concept percentages, not a separate measurement of its
 * own), and a tier-by-tier response count for the 4-card "Not yet /
 * Partly / Got it / Can teach" summary.
 */
export function getLessonFeedbackSummary(classroom, lesson) {
  const students = getAllStudents(classroom);
  const eligibleConceptIds = getFeedbackEligibleConceptIds(lesson);
  const conceptStats = eligibleConceptIds.map((conceptId) => getConceptFeedbackStats(classroom, conceptId));

  const respondedStudentCount = students.filter((student) =>
    eligibleConceptIds.some((conceptId) => getUnderstanding(student, conceptId) !== 'not_marked')
  ).length;

  const tierCounts = { not_marked: 0, need_help: 0, understand: 0, confident: 0, can_teach: 0 };
  eligibleConceptIds.forEach((conceptId) => {
    students.forEach((student) => {
      const understanding = getUnderstanding(student, conceptId);
      tierCounts[understanding] = (tierCounts[understanding] || 0) + 1;
    });
  });

  const overallUnderstandingPercent =
    conceptStats.length > 0 ? Math.round(conceptStats.reduce((sum, stat) => sum + stat.positivePercent, 0) / conceptStats.length) : 0;

  // Every real response (any tier EXCEPT not_marked) across every
  // executed concept — the denominator for each tier's own percentage
  // below, and for the combined Got it + Can teach metric. Kept
  // separate from respondedStudentCount (a per-STUDENT count: did they
  // answer at least one concept) — this is a per-RESPONSE count (one
  // student can contribute up to eligibleConceptIds.length responses),
  // matching the reference's own worked example (e.g. "5/12" where 12
  // is total responses across several concepts, not total students).
  const totalResponses = tierCounts.need_help + tierCounts.understand + tierCounts.confident + tierCounts.can_teach;

  const tierPercentages = {
    need_help: totalResponses > 0 ? Math.round((tierCounts.need_help / totalResponses) * 100) : 0,
    understand: totalResponses > 0 ? Math.round((tierCounts.understand / totalResponses) * 100) : 0,
    confident: totalResponses > 0 ? Math.round((tierCounts.confident / totalResponses) * 100) : 0,
    can_teach: totalResponses > 0 ? Math.round((tierCounts.can_teach / totalResponses) * 100) : 0,
  };

  // The reference's own "useful combined measure" — Got it (confident)
  // + Can teach, kept as an ADDITIONAL number alongside the per-tier
  // breakdown above, never a replacement for it (response rate and
  // understanding stay separate per explicit product decision — see
  // this file's own header comment).
  const combinedPositiveCount = tierCounts.confident + tierCounts.can_teach;
  const combinedPositivePercent = totalResponses > 0 ? Math.round((combinedPositiveCount / totalResponses) * 100) : 0;

  return {
    totalStudents: students.length,
    respondedStudentCount,
    overallUnderstandingPercent,
    conceptStats,
    tierCounts,
    totalResponses,
    tierPercentages,
    combinedPositiveCount,
    combinedPositivePercent,
  };
}
