/**
 * services/programmeSessionService.js
 *
 * Orchestrates the ProgrammeSession domain: validating input,
 * confirming the referenced Learning Programme actually exists,
 * enforcing the historical-stability invariants described in
 * models/ProgrammeSession.js's own header comment, and persisting
 * through services/programmeSessionRepository.js. Mirrors
 * services/plannerService.js's own split exactly: the pure "compute/
 * validate" functions in this file never talk to Firestore directly,
 * and the repository never contains domain logic — this file is the
 * only place the two meet.
 *
 * CRITICAL, load-bearing rule for every function below that mutates
 * an existing session: NONE of them ever reads a Learning Programme's
 * CURRENT configuration back into that session. A session's `goals`,
 * `componentInstances`, etc. are populated only from what's explicitly
 * passed in by the caller at the moment of the real action (a
 * teacher/student actually doing something), never by re-fetching
 * "what does this programme currently support" and writing that in.
 * This is what makes invariants #23.1–3 from this project's own
 * Learning Programmes Audit Report true by construction rather than
 * by convention someone has to remember.
 *
 * Every mutating function here takes the actual ProgrammeSession
 * object and mutates it in place, then returns it — matching
 * services/checkpointService.js's own established convention (the
 * caller is responsible for persisting afterward, via this file's
 * own save*() functions, which call the repository).
 *
 * IMPLEMENTATION NOTE — services/programmeSessionRepository.js is
 * loaded via a dynamic `import()` inside the handful of functions
 * that actually persist (createAndSaveSession, getSessionById,
 * listSessionsForProgramme, saveSessionPatch), rather than a static
 * top-level import. This is a deliberate deviation from
 * services/plannerService.js's own static-import precedent, made for
 * one concrete reason: the repository's own file imports the Firebase
 * SDK via an `https://` URL specifier, which every browser this app
 * ships to resolves natively, but which this project's own sandbox
 * test environment cannot load at all (Node's default ESM loader only
 * supports `file:`/`data:`/`node:` specifiers — see
 * services/programmeSessionRepository.js's own header comment). A
 * static top-level import would make every pure validation/mutation
 * function in this file — none of which need Firestore at all —
 * untestable in this environment purely as a side effect of module
 * loading. A dynamic import behaves identically to a static one at
 * runtime in the browser and changes nothing about this file's own
 * public behaviour; it exists solely to keep this file's substantial
 * pure-logic surface unit-testable without a live Firebase project.
 */

import { createProgrammeSession, createAttendanceEntry, createProgrammeGoalEntry, createActivityEntry, createTeacherObservationEntry } from '../models/ProgrammeSession.js';
import * as learningProgrammeService from './learningProgrammeService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { isNonEmptyString, isValidDateString } from '../utils/validators.js';

const VALID_GOAL_SOURCES = ['suggested', 'custom'];
const VALID_GOAL_OUTCOMES = ['completed', 'partially_completed', 'try_again'];

/**
 * Confirms `programmeId` refers to a real, existing Learning
 * Programme on this classroom — throws rather than silently creating
 * an orphaned session referencing nothing. Exported so a caller (or a
 * test) can check this ahead of time without attempting a create.
 */
export function ensureProgrammeExists(classroom, programmeId) {
  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    throw new Error(`Cannot create ProgrammeSession: no Learning Programme with id "${programmeId}" exists on this classroom`);
  }
  return programme;
}

/** Basic shape validation for a new session — deliberately lightweight, matching services/learningProgrammeService.js's own validateLearningProgrammeInput(). */
export function validateProgrammeSessionInput({ programmeId, date } = {}) {
  const errors = [];
  if (!isNonEmptyString(programmeId)) errors.push('programmeId is required');
  if (date !== undefined && !isValidDateString(date)) errors.push('date must be a valid date string');
  return errors;
}

/**
 * A light membership check, not a hard security boundary: confirms
 * this student has AT LEAST ONE membership record (active or
 * historical) in this programme before letting a session reference
 * them — catches an obvious mistake (recording attendance/a goal for
 * a student who was never actually part of this programme) without
 * being so strict that a student's historical attendance becomes
 * unrecordable after they've left. Never blocks recording for an
 * already-`left` member — leaving a programme doesn't erase the fact
 * that they were once genuinely part of it.
 */
function ensureStudentHasMembership(programme, studentId) {
  const hasAnyMembership = learningProgrammeService.getMembershipsForStudent(programme, studentId).length > 0;
  if (!hasAnyMembership) {
    throw new Error(`Cannot record an entry for studentId "${studentId}": they have no membership record in programme "${programme.id}"`);
  }
}

/**
 * Builds a new, in-memory ProgrammeSession for an existing programme
 * — pure, does not touch Firestore. Exported separately from
 * createAndSaveSession() below so tests can exercise the validation/
 * construction logic without needing a live repository.
 */
export function buildNewSession(classroom, { programmeId, date, title } = {}) {
  const errors = validateProgrammeSessionInput({ programmeId, date });
  if (errors.length > 0) {
    throw new Error(`Cannot create ProgrammeSession: ${errors.join('; ')}`);
  }
  ensureProgrammeExists(classroom, programmeId);

  return createProgrammeSession({ programmeId, date, title });
}

/** Builds a new session and persists it in one step — the one place "construct" and "save" meet, matching services/plannerService.js's own generateAndSaveLessons(). */
export async function createAndSaveSession(classroom, { programmeId, date, title } = {}) {
  const session = buildNewSession(classroom, { programmeId, date, title });
  const programmeSessionRepository = await import('./programmeSessionRepository.js');
  await programmeSessionRepository.createSession(classroom.id, session);
  return session;
}

export async function getSessionById(classroomId, sessionId) {
  const programmeSessionRepository = await import('./programmeSessionRepository.js');
  return programmeSessionRepository.getSessionById(classroomId, sessionId);
}

export async function listSessionsForProgramme(classroomId, programmeId) {
  const programmeSessionRepository = await import('./programmeSessionRepository.js');
  return programmeSessionRepository.listSessionsForProgramme(classroomId, programmeId);
}

// ---------------------------------------------------------------------
// In-memory mutation helpers — pure; the caller persists afterward via
// saveSessionPatch() below, matching services/checkpointService.js's
// own "mutate the passed-in object, caller persists" split.
// ---------------------------------------------------------------------

/** Records or updates one student's attendance for this session — a student may only have one attendance entry per session; recording again replaces their own existing entry rather than appending a duplicate. */
export function recordAttendance(programme, session, { studentId, status }) {
  ensureStudentHasMembership(programme, studentId);

  const existing = session.attendance.find((entry) => entry.studentId === studentId);
  if (existing) {
    existing.status = status;
    existing.recordedAt = getCurrentIsoDate();
  } else {
    session.attendance.push(createAttendanceEntry({ studentId, status }));
  }
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * Adds a new daily goal entry for one student in this session — per
 * models/ProgrammeSession.js's own header comment, this is always a
 * NEW entry, never an update to some prior day's goal; a student may
 * have at most one goal per category within a single session, so
 * calling this twice for the same (studentId, categoryId) within the
 * same session replaces that entry rather than creating a duplicate.
 */
export function recordGoal(programme, session, { studentId, categoryId, text, source = 'custom', outcome = null, reflection = '' }) {
  ensureStudentHasMembership(programme, studentId);
  if (!VALID_GOAL_SOURCES.includes(source)) {
    throw new Error(`Invalid goal source "${source}" — must be one of: ${VALID_GOAL_SOURCES.join(', ')}`);
  }
  if (outcome !== null && !VALID_GOAL_OUTCOMES.includes(outcome)) {
    throw new Error(`Invalid goal outcome "${outcome}" — must be null or one of: ${VALID_GOAL_OUTCOMES.join(', ')}`);
  }

  const existingIndex = session.goals.findIndex((goal) => goal.studentId === studentId && goal.categoryId === categoryId);
  const entry = createProgrammeGoalEntry({ studentId, categoryId, text, source, outcome, reflection });
  if (existingIndex >= 0) {
    session.goals[existingIndex] = entry;
  } else {
    session.goals.push(entry);
  }
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/** Records this session's own outcome/reflection for an already-recorded goal — never touches `text`/`source`, matching the "outcome is recorded after the fact, the goal itself doesn't change" product decision. No-op (returns `null`) if no such goal exists yet in this session. */
export function recordGoalOutcome(session, { studentId, categoryId, outcome, reflection }) {
  const goal = session.goals.find((g) => g.studentId === studentId && g.categoryId === categoryId);
  if (!goal) return null;

  if (outcome !== undefined) {
    if (outcome !== null && !VALID_GOAL_OUTCOMES.includes(outcome)) {
      throw new Error(`Invalid goal outcome "${outcome}" — must be null or one of: ${VALID_GOAL_OUTCOMES.join(', ')}`);
    }
    goal.outcome = outcome;
  }
  if (reflection !== undefined) goal.reflection = reflection;

  session.updatedAt = getCurrentIsoDate();
  return goal;
}

/** Records one activity that actually took place during this session — always appended, never deduplicated against a programme's own activity suggestions (see models/ProgrammeSession.js's own createActivityEntry() header comment). */
export function recordActivity(session, { name, notes = '' }) {
  session.activities.push(createActivityEntry({ name, notes }));
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/** Records a teacher's own observation about one student during this session. */
export function recordTeacherObservation(programme, session, { studentId, note }) {
  ensureStudentHasMembership(programme, studentId);
  session.teacherObservations.push(createTeacherObservationEntry({ studentId, note }));
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * Sets one component's own instance value for this session —
 * `componentId` references an entry in the owning programme's own
 * `configuration.defaultComponents`/`extensions`, but this function
 * does not validate the value's own shape against that component's
 * `type` (see models/ProgrammeSession.js's own header comment: no
 * generic component/form engine is being built in Phase 1). A
 * component absent from `componentInstances` on an older session
 * simply never happened for that occurrence — this function is the
 * only way an entry is ever added, and it is never called
 * retroactively for past sessions when a new component is defined.
 */
export function setComponentInstance(session, componentId, value) {
  session.componentInstances[componentId] = value;
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * Persists whatever fields actually changed on an already-created
 * session — the caller passes exactly the fields it touched (e.g.
 * `{ attendance, updatedAt }` after recordAttendance()), matching
 * services/programmeSessionRepository.js's own updateSession()'s
 * "dumb, caller computes the patch" convention.
 */
export async function saveSessionPatch(classroomId, sessionId, patch) {
  const programmeSessionRepository = await import('./programmeSessionRepository.js');
  await programmeSessionRepository.updateSession(classroomId, sessionId, patch);
}
