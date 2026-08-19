/**
 * services/programmeSessionService.js
 *
 * Orchestrates the ProgrammeSession domain: validating input,
 * confirming the referenced Learning Programme actually exists (and,
 * as of Phase 1.6, is not archived — see ensureProgrammeCanStartNewSession()
 * below), enforcing the historical-stability invariants described in
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
 * own save*()/build*Patch() functions, which call or feed the
 * repository).
 *
 * PHASE 1.6 CONCURRENCY HARDENING — every per-student mutation
 * function below (recordAttendance, recordGoal, recordGoalOutcome,
 * recordTeacherObservation) now touches only that ONE student's own
 * key inside `session.attendance`/`session.goals`/
 * `session.teacherObservations` (student-keyed maps as of this phase
 * — see models/ProgrammeSession.js's own header comment), never the
 * whole map. Each has a matching `build*Patch()` function below that
 * computes the SMALLEST Firestore field-path patch capable of
 * persisting exactly that one student's own change — e.g.
 * `{ 'attendance.<studentId>': {...} }` — so two facilitators
 * recording different students' entries in the same session, at
 * nearly the same time, can no longer have one's write clobber the
 * other's. This uses Firestore's own native nested-field merge
 * behaviour inside `updateDoc()`; no transaction, lock, or
 * synchronization framework was introduced (see this project's own
 * Learning Programmes Hardening authorization's own explicit
 * "do not overengineer concurrency" instruction). `recordActivity`/
 * `setComponentInstance` are unchanged from Phase 1 — `activities`
 * stays a plain, session-wide array (not per-student, so there is no
 * per-student race to guard against), and `componentInstances` was
 * already map-shaped.
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
 * Deliberately does NOT check archival status — that is a distinct
 * concern with its own, separately-named function (see
 * ensureProgrammeCanStartNewSession() below), so a future caller that
 * only cares about existence (e.g. reading a programme's
 * configuration) never has to reason about session-creation rules to
 * use this one.
 */
export function ensureProgrammeExists(classroom, programmeId) {
  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    throw new Error(`Cannot create ProgrammeSession: no Learning Programme with id "${programmeId}" exists on this classroom`);
  }
  return programme;
}

/**
 * PHASE 1.6 — an archived programme cannot start a NEW session
 * (per this project's own Learning Programmes Hardening
 * authorization, Issue 4). Throws a clear, distinct error Phase 2 can
 * catch and surface to a teacher, rather than silently allowing it or
 * only warning in a UI layer that doesn't exist yet.
 *
 * Deliberately does NOT affect anything about a programme's already-
 * existing sessions: this function is only ever called from
 * buildNewSession() below, at the moment of creating a brand new
 * session document. It has no interaction whatsoever with
 * getSessionById()/listSessionsForProgramme() — an already-persisted
 * session remains exactly as readable, and exactly as unchanged, after
 * its owning programme is archived as it was before. archiveProgramme()
 * itself (services/learningProgrammeService.js) never touches a
 * session, and no session-reading function here ever checks a
 * programme's own `status` — this function is the ONE place, and the
 * only place, that status is consulted at all in this file.
 */
export function ensureProgrammeCanStartNewSession(programme) {
  if (programme.status === 'archived') {
    throw new Error(`Cannot create a new ProgrammeSession: programme "${programme.id}" is archived`);
  }
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
 * that they were once genuinely part of it. Unchanged from Phase 1 —
 * this project's own Phase 1.6 authorization explicitly preserves
 * this deliberate behaviour rather than tightening it to an
 * active-only or date-scoped check (see
 * services/learningProgrammeService.js's own wasStudentMemberOn() for
 * a separate, additive, date-aware helper that does NOT replace this
 * one).
 */
function ensureStudentHasMembership(programme, studentId) {
  const hasAnyMembership = learningProgrammeService.getMembershipsForStudent(programme, studentId).length > 0;
  if (!hasAnyMembership) {
    throw new Error(`Cannot record an entry for studentId "${studentId}": they have no membership record in programme "${programme.id}"`);
  }
}

/**
 * Builds a new, in-memory ProgrammeSession for an existing, non-
 * archived programme — pure, does not touch Firestore. Exported
 * separately from createAndSaveSession() below so tests can exercise
 * the validation/construction logic without needing a live
 * repository.
 */
export function buildNewSession(classroom, { programmeId, date, title } = {}) {
  const errors = validateProgrammeSessionInput({ programmeId, date });
  if (errors.length > 0) {
    throw new Error(`Cannot create ProgrammeSession: ${errors.join('; ')}`);
  }
  const programme = ensureProgrammeExists(classroom, programmeId);
  ensureProgrammeCanStartNewSession(programme);

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
// saveSessionPatch() (or one of the build*Patch() functions further
// below) matching services/checkpointService.js's own "mutate the
// passed-in object, caller persists" split.
// ---------------------------------------------------------------------

/**
 * Records or updates one student's attendance for this session —
 * touches only `session.attendance[studentId]`; every other
 * student's own attendance entry, and every other field on this
 * session, is completely untouched in memory (and, if persisted via
 * buildAttendancePatch() below rather than a full-session write, at
 * the Firestore level too).
 */
export function recordAttendance(programme, session, { studentId, status }) {
  ensureStudentHasMembership(programme, studentId);

  session.attendance[studentId] = createAttendanceEntry({ status });
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * The smallest Firestore patch that persists exactly one student's
 * own just-recorded attendance — call this (via saveSessionPatch())
 * after recordAttendance() instead of writing the whole `attendance`
 * map back, so a concurrent facilitator's own write to a DIFFERENT
 * student's attendance in the same session can never be lost. Relies
 * on Firestore's own native support for dot-path nested-field updates
 * inside `updateDoc()` — no transaction or lock needed.
 */
export function buildAttendancePatch(session, studentId) {
  return {
    [`attendance.${studentId}`]: session.attendance[studentId],
    updatedAt: session.updatedAt,
  };
}

/**
 * Adds or replaces one student's own goal for one category within
 * this session — per models/ProgrammeSession.js's own header comment,
 * a student may have at most one goal per category within a single
 * session; calling this twice for the same (studentId, categoryId)
 * replaces that entry rather than creating a duplicate. Touches only
 * `session.goals[studentId][categoryId]` — every other category for
 * this student, and every other student's goals entirely, are
 * untouched.
 */
export function recordGoal(programme, session, { studentId, categoryId, text, source = 'custom', outcome = null, reflection = '' }) {
  ensureStudentHasMembership(programme, studentId);
  if (!VALID_GOAL_SOURCES.includes(source)) {
    throw new Error(`Invalid goal source "${source}" — must be one of: ${VALID_GOAL_SOURCES.join(', ')}`);
  }
  if (outcome !== null && !VALID_GOAL_OUTCOMES.includes(outcome)) {
    throw new Error(`Invalid goal outcome "${outcome}" — must be null or one of: ${VALID_GOAL_OUTCOMES.join(', ')}`);
  }

  if (!session.goals[studentId]) session.goals[studentId] = {};
  session.goals[studentId][categoryId] = createProgrammeGoalEntry({ text, source, outcome, reflection });
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * The smallest Firestore patch that persists exactly one student's
 * own just-recorded goal for one category — call this (via
 * saveSessionPatch()) after recordGoal()/recordGoalOutcome() instead
 * of writing the whole `goals` map back, so a concurrent facilitator
 * recording a DIFFERENT student's goal (or this same student's own
 * goal in a DIFFERENT category) in the same session can never be
 * lost.
 */
export function buildGoalPatch(session, studentId, categoryId) {
  return {
    [`goals.${studentId}.${categoryId}`]: session.goals[studentId][categoryId],
    updatedAt: session.updatedAt,
  };
}

/** Records this session's own outcome/reflection for an already-recorded goal — never touches `text`/`source`, matching the "outcome is recorded after the fact, the goal itself doesn't change" product decision. No-op (returns `null`) if no such goal exists yet in this session. */
export function recordGoalOutcome(session, { studentId, categoryId, outcome, reflection }) {
  const goal = session.goals[studentId]?.[categoryId];
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

/** Records one activity that actually took place during this session — always appended, never deduplicated against a programme's own activity suggestions (see models/ProgrammeSession.js's own createActivityEntry() header comment). Unchanged from Phase 1: `activities` is session-wide, not per-student, so there is no per-student race to guard against here — a full-array write remains appropriate. */
export function recordActivity(session, { name, notes = '' }) {
  session.activities.push(createActivityEntry({ name, notes }));
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * Records a teacher's own observation about one student during this
 * session — appended to `session.teacherObservations[studentId]`'s
 * own array (a student may have more than one observation per
 * session, unlike attendance). Touches only this one student's own
 * array; every other student's observations are untouched.
 */
export function recordTeacherObservation(programme, session, { studentId, note }) {
  ensureStudentHasMembership(programme, studentId);

  if (!session.teacherObservations[studentId]) session.teacherObservations[studentId] = [];
  session.teacherObservations[studentId].push(createTeacherObservationEntry({ note }));
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * The smallest Firestore patch that persists exactly one student's
 * own full list of teacher observations — call this (via
 * saveSessionPatch()) after recordTeacherObservation() instead of
 * writing the whole `teacherObservations` map back. Note this is the
 * one student's own whole ARRAY, not a single entry within it — that
 * is the smallest granularity Firestore's own field-path addressing
 * can safely target for an array without more complex machinery this
 * project's own Hardening authorization explicitly asked not to
 * introduce (no distributed locks, no optimistic-concurrency
 * framework); it still fully satisfies the actual requirement, since
 * two DIFFERENT students' own observation arrays never share a field
 * path and can never clobber each other.
 */
export function buildTeacherObservationPatch(session, studentId) {
  return {
    [`teacherObservations.${studentId}`]: session.teacherObservations[studentId],
    updatedAt: session.updatedAt,
  };
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
 * Unchanged from Phase 1 — `componentInstances` was already
 * map-shaped, so it already had this same field-level update property.
 */
export function setComponentInstance(session, componentId, value) {
  session.componentInstances[componentId] = value;
  session.updatedAt = getCurrentIsoDate();
  return session;
}

/**
 * The smallest Firestore patch that persists exactly one component's
 * own instance value — mirrors buildAttendancePatch()/buildGoalPatch()
 * for the same reason, even though componentInstances was already
 * map-shaped in Phase 1: a caller that already has a build*Patch()
 * convention to reach for on every other field should have one here
 * too, rather than needing to remember this one field is "already
 * fine" and hand-write its own dot path.
 */
export function buildComponentInstancePatch(session, componentId) {
  return {
    [`componentInstances.${componentId}`]: session.componentInstances[componentId],
    updatedAt: session.updatedAt,
  };
}

/**
 * Persists whatever fields actually changed on an already-created
 * session — the caller passes exactly the fields it touched (e.g. the
 * result of buildAttendancePatch()/buildGoalPatch()/
 * buildTeacherObservationPatch()/buildComponentInstancePatch() above,
 * or a hand-built patch for `activities`/`title`/etc., which remain
 * whole-field writes since they were never per-student to begin
 * with), matching services/programmeSessionRepository.js's own
 * updateSession()'s "dumb, caller computes the patch" convention.
 */
export async function saveSessionPatch(classroomId, sessionId, patch) {
  const programmeSessionRepository = await import('./programmeSessionRepository.js');
  await programmeSessionRepository.updateSession(classroomId, sessionId, patch);
}
