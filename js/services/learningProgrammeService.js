/**
 * services/learningProgrammeService.js
 *
 * Learning Programme configuration management — mirrors
 * services/plannerService.js's own cycle-management half directly:
 * plain functions taking a classroom/programme and mutating in
 * place, no class, no hidden state. The caller persists via
 * services/workspaceService.js's save() afterward — this file never
 * calls it itself, matching services/goalService.js's and
 * services/checkpointService.js's own established convention.
 *
 * `classroom.learningProgrammes` is never assumed present — defaulted
 * at the read/write boundary here (see ensureLearningProgrammes()
 * below), the same way services/goalService.js treats
 * `classroom.goalCycles` and services/studentEventService.js treats
 * `classroom.studentEvents`: a brand-new field on an app with many
 * already-deployed classrooms needs no migration script, since every
 * existing classroom simply has no Learning Programmes yet.
 *
 * This file owns everything about a programme's own CONFIGURATION
 * and MEMBERSHIP — never session history (see
 * services/programmeSessionService.js for that). It does not import
 * services/programmeSessionRepository.js or
 * services/programmeSessionService.js at all, matching the "config
 * and history are separate concerns, kept in separate files" split
 * services/plannerService.js already established between its own
 * cycle-management functions and its own
 * generateAndSaveLessons()/updateLessonStatus() functions.
 *
 * Phase 1 explicitly does NOT compute or store any programme
 * score/progress/attendance-percentage of any kind here — see
 * models/LearningProgramme.js's own header comment. Nothing in this
 * file reads services/programmeSessionRepository.js's own session
 * history at all.
 */

import { createLearningProgramme } from '../models/LearningProgramme.js';
import { createProgrammeMembership } from '../models/ProgrammeMembership.js';
import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { isNonEmptyString } from '../utils/validators.js';

function ensureLearningProgrammes(classroom) {
  if (!classroom.learningProgrammes) classroom.learningProgrammes = [];
  return classroom.learningProgrammes;
}

/** Every Learning Programme for this classroom, most recently created first — matches services/assessmentService.js's own listAssessments()/getAssessments() sort convention. */
export function listLearningProgrammes(classroom) {
  return [...ensureLearningProgrammes(classroom)].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getLearningProgrammeById(classroom, programmeId) {
  return ensureLearningProgrammes(classroom).find((programme) => programme.id === programmeId) || null;
}

/**
 * A programme is valid if it has a real name and, once `classroomIds`
 * is provided, every entry in it is a non-empty string — deliberately
 * lightweight: this is input validation, not a state machine (see
 * models/Checkpoint.js's own header comment for the same "model
 * defines shape, this doesn't enforce a workflow" split). Exported so
 * unit tests, and any future UI form, can check a draft programme
 * before attempting to create or update one.
 */
export function validateLearningProgrammeInput({ name, classroomIds } = {}) {
  const errors = [];
  if (!isNonEmptyString(name)) errors.push('name is required');
  if (classroomIds !== undefined) {
    if (!Array.isArray(classroomIds) || classroomIds.length === 0) {
      errors.push('classroomIds must be a non-empty array');
    } else if (!classroomIds.every(isNonEmptyString)) {
      errors.push('classroomIds must contain only non-empty strings');
    }
  }
  return errors;
}

/**
 * Assigns a stable `id` to every goal-framework category that doesn't
 * already have one — mints ids at the point a programme is actually
 * created, mirroring services/goalService.js's own addCategory()
 * calling createGoalCategory() to mint an id at the point of use,
 * rather than expecting config data (see
 * config/englishLiteracyCircleDefaults.js) to already carry one.
 */
function withCategoryIds(categories = []) {
  return categories.map((category) => ({
    id: category.id || generateId(),
    name: category.name,
    suggestedGoals: category.suggestedGoals ? [...category.suggestedGoals] : [],
  }));
}

/**
 * Creates a new Learning Programme and appends it to the classroom's
 * own list — does NOT call workspaceService.save() itself, matching
 * services/checkpointService.js's own createNewCheckpoint() (mutate
 * and return; the caller persists). `classroomIds` defaults to just
 * this classroom's own id — Phase 1 never creates a programme spanning
 * more than one classroom, but the field itself must never assume a
 * cardinality of exactly one (see models/LearningProgramme.js's own
 * header comment), so it is always a real array, never a bare string.
 *
 * Throws if `validateLearningProgrammeInput()` finds a problem, the
 * same "fail loudly on invalid input, don't silently create a broken
 * record" approach this service's own validation function exists to
 * support.
 */
export function createNewLearningProgramme(classroom, { name, description = '', ownerId = null, facilitatorUids = [], classroomIds, configuration = {} } = {}) {
  const resolvedClassroomIds = classroomIds || [classroom.id];
  const errors = validateLearningProgrammeInput({ name, classroomIds: resolvedClassroomIds });
  if (errors.length > 0) {
    throw new Error(`Cannot create Learning Programme: ${errors.join('; ')}`);
  }

  const programme = createLearningProgramme({
    name,
    description,
    ownerId,
    facilitatorUids,
    classroomIds: resolvedClassroomIds,
    configuration: {
      ...configuration,
      goalFramework: {
        categories: withCategoryIds(configuration.goalFramework?.categories),
      },
    },
  });

  ensureLearningProgrammes(classroom).push(programme);
  return programme;
}

/**
 * Updates only the fields provided — `undefined` means "leave this
 * field alone," matching services/checkpointService.js's own
 * updateCheckpoint() convention exactly. Never touches `id`,
 * `createdAt`, `memberships`, or `status` — use archiveProgramme()
 * for status, and the dedicated membership functions below for
 * memberships. Always stamps `updatedAt`, so a later session/read can
 * tell configuration changed without needing to diff it.
 *
 * Per the historical-stability invariant (see
 * models/ProgrammeSession.js's own header comment), calling this can
 * NEVER reach into any already-created ProgrammeSession — this
 * function's only side effect is on the programme object itself.
 */
export function updateProgrammeConfiguration(programme, { name, description, ownerId, facilitatorUids, configuration } = {}) {
  if (name !== undefined) programme.name = name;
  if (description !== undefined) programme.description = description;
  if (ownerId !== undefined) programme.ownerId = ownerId;
  if (facilitatorUids !== undefined) programme.facilitatorUids = facilitatorUids;

  if (configuration !== undefined) {
    if (configuration.defaultComponents !== undefined) {
      programme.configuration.defaultComponents = configuration.defaultComponents;
    }
    if (configuration.extensions !== undefined) {
      programme.configuration.extensions = configuration.extensions;
    }
    if (configuration.goalFramework?.categories !== undefined) {
      programme.configuration.goalFramework.categories = withCategoryIds(configuration.goalFramework.categories);
    }
    if (configuration.settings !== undefined) {
      programme.configuration.settings = configuration.settings;
    }
  }

  programme.updatedAt = getCurrentIsoDate();
  return programme;
}

/** Archives a programme — never deletes it, its memberships, or (elsewhere) its session history. A archived programme's own past sessions remain exactly as readable as before. */
export function archiveProgramme(programme) {
  programme.status = 'archived';
  programme.updatedAt = getCurrentIsoDate();
  return programme;
}

// ---------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------

/** Every membership record this student has ever had in this programme, in creation order — the full history, including any already-`left` stints. */
export function getMembershipsForStudent(programme, studentId) {
  return programme.memberships.filter((membership) => membership.studentId === studentId);
}

/** This student's own current membership, if they have one right now — `null` if they've never joined, or if their only/most recent stint has already ended. */
export function getActiveMembership(programme, studentId) {
  return programme.memberships.find((membership) => membership.studentId === studentId && membership.status === 'active') || null;
}

/** Every student currently active in this programme — resolved fresh from `memberships` every time, never a separately-maintained list that could drift out of sync with it. */
export function getActiveMembers(programme) {
  return programme.memberships.filter((membership) => membership.status === 'active');
}

/**
 * Adds a new membership for this student — a no-op (returns the
 * existing record) if they already have an active one, so calling
 * this twice in a row can never produce two simultaneous active
 * memberships for the same student. If the student has previously
 * left, this creates a brand NEW membership record for the new stint
 * — their earlier, already-`left` record is never revived or
 * overwritten (see models/ProgrammeMembership.js's own header
 * comment for exactly why).
 */
export function addMembership(programme, studentId, joinedAt) {
  const existingActive = getActiveMembership(programme, studentId);
  if (existingActive) return existingActive;

  const membership = createProgrammeMembership({ studentId, joinedAt });
  programme.memberships.push(membership);
  programme.updatedAt = getCurrentIsoDate();
  return membership;
}

/**
 * Marks this student as having left — sets `leftAt`/`status` on their
 * own existing active record; NEVER deletes it. A no-op (returns
 * `null`) if the student has no active membership to end, so calling
 * this on a student who was never a member, or who already left,
 * can't corrupt anything.
 */
export function markMembershipLeft(programme, studentId, leftAt) {
  const membership = getActiveMembership(programme, studentId);
  if (!membership) return null;

  membership.leftAt = leftAt || getCurrentIsoDate();
  membership.status = 'left';
  programme.updatedAt = getCurrentIsoDate();
  return membership;
}
