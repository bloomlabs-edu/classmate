/**
 * models/WeeklyPlanSubmission.js
 *
 * The status/audit envelope for a Fellow's Weekly Plan — the concise,
 * whole-week planning artifact reviewed by a Program Manager every
 * weekend, distinct from the detailed "5 Questions" LessonPlan (see
 * docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md and
 * models/LessonPlan.js's own header comment on that split).
 *
 * DELIBERATELY carries no planning content at all — no Unit, Topic,
 * Big Question, Objective, Plan, or Assessment. That content already
 * lives on each day's models/Lesson.js document
 * (`curriculumUnitId`/`conceptIds`/`objectives`/`bigQuestion`, plus the
 * two new `planSummary`/`assessmentNote` fields added alongside this
 * model) and is always read live for the review grid — never
 * snapshotted here. This document answers exactly one question, "has
 * this Fellow submitted next week's plan, and what's its review
 * status," independent of whether any period that week has a detailed
 * LessonPlan at all.
 *
 * One document per (classroomId, teacherUid, weekStartDate) —
 * deterministic composite id via buildWeeklyPlanSubmissionId() below,
 * the same "doc id is the identity being checked, one get(), never a
 * query" principle already established elsewhere in this codebase
 * (e.g. the Learner Identity Bridge design's own `{a}_{b}` convention).
 * `weekStartDate` is always the Monday of the week (see
 * utils/dateHelpers.js's getMondayStartOfWeek()), so a given week has
 * exactly one canonical key regardless of which day within it a caller
 * started from.
 *
 * `status` is its OWN enum (WEEKLY_PLAN_SUBMISSION_STATUS below) —
 * deliberately NOT imported from models/LessonPlan.js's
 * LESSON_PLAN_STATUS, even though the four string values happen to
 * read the same. Per explicit product direction: Weekly Plan review
 * and Observation Lesson Plan review are two separate responsibilities
 * with two separate lifecycles that must never be conflated by sharing
 * one enum object — a future change to one must not risk silently
 * affecting the other.
 *
 * `status: 'draft'` is a real, storable state here (unlike the "Not
 * started"/"Draft" distinction the UI shows BEFORE any document
 * exists, which is purely derived from Lesson content — see
 * services/weeklyPlanSubmissionService.js's own
 * getWeekPlanDisplayStatus()). A Fellow may explicitly save a draft
 * record, or go straight from "no document" to 'submitted' — both are
 * valid first writes.
 *
 * `hadChangesRequested` — set true the first time a reviewer requests
 * changes, and never reset. Same "Submitted vs Resubmitted" distinction
 * services/lessonPlanReviewService.js's own getSubmissionLabel() makes
 * for a LessonPlan, computed here as a plain stored boolean instead of
 * derived from an append-only reviewHistory array — this record is
 * deliberately lighter than a LessonPlan's (no per-round history, no
 * comments; see the architecture note in
 * docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md for why a
 * second discussion/comment system was explicitly not built for this
 * phase).
 */

import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export const WEEKLY_PLAN_SUBMISSION_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
});

/** Deterministic composite id — one document per Fellow+Classroom+Week, computable by any caller (client or Firestore rule) that already knows these three values, never a query. */
export function buildWeeklyPlanSubmissionId(classroomId, teacherUid, weekStartDate) {
  return `${classroomId}_${teacherUid}_${weekStartDate}`;
}

export function createWeeklyPlanSubmission({
  id,
  classroomId,
  teacherUid,
  weekStartDate,
  status = WEEKLY_PLAN_SUBMISSION_STATUS.DRAFT,
  createdByUid,
  submittedAt = null,
  hadChangesRequested = false,
  reviewerUid = null,
  reviewedAt = null,
  createdAt,
  updatedAt,
} = {}) {
  const now = getCurrentIsoDate();
  return {
    id: id || buildWeeklyPlanSubmissionId(classroomId, teacherUid, weekStartDate),
    classroomId,
    teacherUid,
    weekStartDate,
    status,
    createdByUid: createdByUid || teacherUid,
    submittedAt,
    hadChangesRequested,
    reviewerUid,
    reviewedAt,
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
  };
}
