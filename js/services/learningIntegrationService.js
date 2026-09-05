/**
 * services/learningIntegrationService.js
 *
 * The single ClassMate-side service boundary for the future Learning
 * Hub / external-activity (e.g. Kahoot) integration — see
 * docs/LEARNING_HUB_INTEGRATION_CONTRACT.md for the full contract this
 * file implements. Its whole purpose is to keep integration logic in
 * one place instead of scattered across UI components: every other
 * file in this app that needs to create an Activity, assign one to a
 * classroom, resolve how to launch it, or record a result should call
 * through here, never reach into models/Activity.js,
 * repositories/activityRepository.js, or
 * services/learningActivityService.js's submission internals
 * directly.
 *
 * Deliberately NOT a network API. Nothing in this file is reachable
 * from outside this app's own trusted code — there is no HTTP
 * endpoint, no exposed write path a client-side URL parameter could
 * drive. That absence of a network surface *is* the security boundary
 * for this phase (see docs/LEARNING_HUB_INTEGRATION_CONTRACT.md's own
 * Security section) until a real, authenticated result-ingestion path
 * is built later. recordResult() below validates identity/shape
 * against this classroom's own already-loaded data because that
 * validation will still be needed once a real network boundary exists
 * in front of it — it is not a substitute for one.
 *
 * Persistence split, matching this app's existing convention (see
 * services/resourceService.js's own header comment for the same
 * split applied to Resources):
 *   - Activity documents (their own Firestore subcollection) are
 *     awaited and durably saved by the functions in this file
 *     directly.
 *   - Assignment (models/LearningActivity.js, embedded in
 *     `classroom.learningActivities[]`) and Result
 *     (`student.submissions[activityId]`) mutations are synchronous,
 *     in-memory only — the caller is responsible for
 *     workspaceService.markDirty()/saveExplicitly(), exactly like
 *     every other classroom-document mutation in this app.
 */

import { createActivity as createActivityModel } from '../models/Activity.js';
import * as activityRepository from '../repositories/activityRepository.js';
import * as learningActivityService from './learningActivityService.js';
import { SUBMISSION_STATUSES } from '../config/submissionStatuses.js';

/** Creates and durably saves a new Activity definition — the reusable "what to do", not yet assigned to any classroom roster. */
export async function createActivity(classroomId, { conceptId, title, description = '', activityType = 'native', externalProvider = null, destination = null, scoreMax = null }) {
  const activity = createActivityModel({ conceptId, title, description, activityType, externalProvider, destination, scoreMax });
  await activityRepository.saveActivity(classroomId, activity);
  return activity;
}

/** Every Activity in one classroom, regardless of which Concept it's linked to. */
export async function getActivitiesForClassroom(classroomId) {
  return activityRepository.getActivitiesForClassroom(classroomId);
}

/** One Activity by id, or null if it no longer exists — never throws for a missing/deleted Activity, the same "broken reference is handled gracefully" convention services/resourceService.js already uses for Resources. */
export async function getActivityById(classroomId, activityId) {
  const activities = await activityRepository.getActivitiesForClassroom(classroomId);
  return activities.find((activity) => activity.id === activityId) || null;
}

/** Every Activity linked to one Concept, for the Concept Profile's own Activities tab (see ui/views/ConceptWorkspaceView.js). */
export async function getActivitiesForConcept(classroomId, conceptId) {
  const activities = await activityRepository.getActivitiesForClassroom(classroomId);
  return activities.filter((activity) => activity.conceptId === conceptId);
}

/**
 * Assigns an Activity to this classroom's roster — creates the
 * Assignment (models/LearningActivity.js) that models/Activity.js's
 * own header comment describes: `activityId`/`conceptId` link back to
 * the Activity definition, so every student's eventual result can
 * trace Student -> Assignment -> Activity -> Concept without a second
 * lookup. Mutates `classroom.learningActivities` in memory only — the
 * caller saves, matching services/learningActivityService.js's own
 * createActivity() convention exactly (this function is a thin,
 * concept-aware wrapper around it, not a second creation path).
 */
export function assignActivityToClassroom(classroom, activity, { title = activity.title, type = 'Assignment', dueDate = '' } = {}) {
  return learningActivityService.createActivity(classroom, {
    title,
    type,
    dueDate,
    activityId: activity.id,
    conceptId: activity.conceptId,
  });
}

/**
 * Removes the Assignment (classroom-roster instance) only — the
 * Activity definition itself is untouched and remains reusable for a
 * future assignment, the same "unlink vs. delete" distinction
 * services/resourceService.js's own unlinkResource()/deleteResource()
 * already draws for Resources. Thin wrapper over the existing
 * services/learningActivityService.js's own deleteActivity() (which
 * already operates on `classroom.learningActivities[]` by id) —
 * exposed here so callers reach it through this file's own boundary,
 * never learningActivityService.js's submission internals directly.
 */
export function unassignActivity(classroom, assignmentId) {
  return learningActivityService.deleteActivity(classroom, assignmentId);
}

/**
 * The launch boundary (see docs/LEARNING_HUB_INTEGRATION_CONTRACT.md's
 * Activity Launch Contract) — resolves everything a future launcher
 * would need to open this Assignment for this student, without this
 * app needing to know how any given activityType is actually
 * implemented. Deliberately does NOT perform any cross-app launch
 * itself (no window.open, no redirect) — it only builds and returns
 * the payload; today's only "launch" behavior anywhere in this app
 * (the existing Resource-based Learning Hub link in
 * ui/views/ConceptWorkspaceView.js) is untouched by this function.
 *
 * A legacy/native Assignment (no `activityId` — see
 * models/LearningActivity.js's own doc comment) resolves to
 * `activityType: 'native'` with a null destination, which is the
 * correct, honest answer: there is nothing to launch outside
 * ClassMate for a plain teacher-authored task.
 */
export async function resolveActivityLaunch(classroom, assignmentId, studentId) {
  const assignment = learningActivityService.getActivityById(classroom, assignmentId);
  if (!assignment) return null;

  let activity = null;
  if (assignment.activityId) {
    activity = await getActivityById(classroom.id, assignment.activityId);
  }

  return {
    assignmentId,
    activityId: assignment.activityId || null,
    activityType: activity ? activity.activityType : 'native',
    destination: activity ? activity.destination : null,
    conceptId: assignment.conceptId || null,
    studentId,
  };
}

function findStudentInRoster(classroom, studentId) {
  for (const team of classroom.teams || []) {
    const student = team.students.find((candidate) => candidate.id === studentId);
    if (student) return student;
  }
  return null;
}

/**
 * Records a Result against an Assignment for one student — the one
 * function a future Learning Hub/external-activity result would
 * eventually flow through (once a real, authenticated network
 * boundary exists in front of it; see this file's own header
 * comment). Validates the four identity pieces the Result contract
 * requires (see docs/LEARNING_HUB_INTEGRATION_CONTRACT.md) against
 * THIS classroom's own already-loaded data — never trusts a caller's
 * own claim about which concept/activity a result belongs to:
 *
 *   - the Assignment must actually exist in this classroom
 *   - the student must actually be on this classroom's roster
 *   - `status` must be a real, known status
 *   - if both `score` and `scoreMax` are given, `0 <= score <= scoreMax`
 *
 * `conceptId` is never accepted from the caller — it's always
 * resolved from the Assignment itself, so a result can never claim a
 * Concept its own Assignment doesn't actually have.
 *
 * Throws on any validation failure rather than silently recording a
 * malformed result — there is no untrusted network caller yet for
 * this to protect against, but the function's own contract should not
 * depend on every future caller already being trustworthy.
 */
export function recordResult(classroom, { assignmentId, studentId, status, score = null, scoreMax = null, completedAt = null, source = 'classmate', feedback = '' }) {
  const assignment = learningActivityService.getActivityById(classroom, assignmentId);
  if (!assignment) throw new Error(`recordResult(): no Assignment "${assignmentId}" exists in this classroom.`);

  const student = findStudentInRoster(classroom, studentId);
  if (!student) throw new Error(`recordResult(): no student "${studentId}" is on this classroom's roster.`);

  if (!SUBMISSION_STATUSES.includes(status)) {
    throw new Error(`recordResult(): "${status}" is not a known status (expected one of ${SUBMISSION_STATUSES.join(', ')}).`);
  }

  if (score !== null && scoreMax !== null && (typeof score !== 'number' || score < 0 || score > scoreMax)) {
    throw new Error(`recordResult(): score (${score}) must be a number between 0 and scoreMax (${scoreMax}).`);
  }

  return learningActivityService.setSubmissionStatus(classroom, student, assignmentId, status, {
    feedback,
    score,
    scoreMax,
    completedAt,
    source,
    conceptId: assignment.conceptId || null,
  });
}
