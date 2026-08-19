/**
 * models/ProgrammeSession.js
 *
 * A ProgrammeSession is the historical record of what actually
 * happened during one Learning Programme occurrence on one date —
 * the Learning Programme domain's equivalent of models/Lesson.js.
 *
 * Deliberately named `ProgrammeSession`, NOT `Session` — this
 * codebase already has services/classSessionService.js's own
 * "Class Session," an unrelated, in-memory, per-browser-tab batch of
 * draft Class Mode actions that is never itself persisted to
 * Firestore and is reviewed/committed/discarded as a whole. A
 * ProgrammeSession is the opposite in every way that matters: it IS
 * the permanent Firestore record (see
 * services/programmeSessionRepository.js), one per real historical
 * occurrence, never an in-memory draft. Using the same name for both
 * would be a real, ongoing source of confusion in this codebase, not
 * just an awkward coincidence — hence the distinct name throughout.
 *
 * Storage: its own Firestore subcollection,
 * `classrooms/{classroomId}/programmeSessions/{sessionId}` (see
 * services/programmeSessionRepository.js's own header comment for
 * why), never embedded on the classroom document — a multi-year
 * history of programme occurrences is exactly the kind of unbounded
 * growth models/LearningProgramme.js's own header comment says an
 * already-substantial classroom document shouldn't have to absorb,
 * the same reasoning models/Lesson.js already established for
 * Planner.
 *
 * CRITICAL invariant, load-bearing for this entire model: a
 * ProgrammeSession is a snapshot of what happened, not a live view
 * computed from the programme's current configuration. Every value
 * recorded here (a chosen goal's own text, which component instances
 * exist, who attended) is copied in at the moment it's recorded and
 * never re-derived later. Concretely:
 *   - Changing `configuration.goalFramework` on the owning
 *     LearningProgramme must never alter an already-recorded
 *     `goals[].text` on a past session.
 *   - Adding a new component to `configuration.defaultComponents`
 *     tomorrow must never retroactively add an empty entry for it to
 *     `componentInstances` on any past session — a component absent
 *     from a session's own `componentInstances` simply didn't exist
 *     for that occurrence, the same "presence means it happened,
 *     absence means it didn't" discipline this app already applies
 *     to StudentCheckpointRecord and Goal.
 * These are enforced by NEVER writing code that re-reads the owning
 * programme's current configuration into an existing session — see
 * services/programmeSessionService.js's own header comment.
 *
 * `attendance`, `goals`, `activities`, `teacherObservations` are
 * plain arrays of small, typed entries (see this file's own
 * `createAttendanceEntry`/`createProgrammeGoalEntry`/
 * `createActivityEntry`/`createTeacherObservationEntry` below) —
 * colocated in this one file rather than four separate model files,
 * mirroring models/GoalCycle.js's own precedent of colocating
 * `createGoalCycle` and `createGoalCategory` together: none of these
 * four entry shapes has independent identity or lifecycle outside a
 * ProgrammeSession, so none earns its own file.
 *
 * `componentInstances` is a plain object, `{ [componentId]: <value> }`
 * — deliberately untyped at this level. What shape a given
 * component's own value takes is entirely owned by that component's
 * `type` (defined in the programme's own
 * `configuration.defaultComponents`/`extensions`), never by this
 * model. Phase 1 does not interpret or validate any specific
 * component value shape — see this project's own Learning Programmes
 * Audit Report §8 for why a generic component/form engine is
 * explicitly not being built yet.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createProgrammeSession({
  id,
  programmeId,
  date,
  title = '',
  startedAt = null,
  endedAt = null,
  attendance = [],
  goals = [],
  activities = [],
  componentInstances = {},
  teacherObservations = [],
  createdAt,
  updatedAt,
} = {}) {
  const resolvedCreatedAt = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    programmeId,
    date: date || resolvedCreatedAt.slice(0, 10),
    title,
    startedAt,
    endedAt,
    attendance,
    goals,
    activities,
    componentInstances,
    teacherObservations,
    createdAt: resolvedCreatedAt,
    updatedAt: updatedAt || resolvedCreatedAt,
  };
}

/**
 * One student's attendance for this exact session — a reference to
 * the classroom's own real student, never a copy of their name.
 * `status` is left as a plain string (e.g. 'present' / 'absent' /
 * 'late') rather than a fixed enum here, matching this app's own
 * "model defines shape, a config/service layer owns the fixed set of
 * valid values" split (see models/WorkRequest.js's own header
 * comment) — Phase 1 does not build the UI that would need to
 * enforce a specific set, so this model does not invent one.
 */
export function createAttendanceEntry({ studentId, status, recordedAt } = {}) {
  return {
    studentId,
    status,
    recordedAt: recordedAt || getCurrentIsoDate(),
  };
}

/**
 * One student's own daily goal for this exact session — this is the
 * Learning Programme domain's own goal shape, deliberately NOT
 * models/Goal.js and NOT built by extending services/goalService.js's
 * GoalCycle (see this project's own Learning Programmes Audit Report
 * §14, Risk #2, for exactly why those two systems are semantically
 * incompatible with this one). A GoalCycle Goal is one persistent
 * goal per category, ticked complete/incomplete day by day; a
 * ProgrammeSession goal is the opposite shape entirely — a brand new
 * entry created fresh for each session, whose `text` is a permanent
 * snapshot of whatever the student actually chose or wrote that day.
 * No permanent "student goal" entity exists anywhere for this system;
 * tomorrow's goal is simply a new entry in tomorrow's own session.
 *
 * `categoryId` references a category inside the owning programme's
 * own `configuration.goalFramework.categories` — resolved live for
 * display (e.g. showing "Reading" today), but `text` itself is never
 * re-derived from that category's current suggested goals; it is
 * exactly what the student chose or wrote at the time, permanently.
 *
 * `source` — 'suggested' | 'custom': whether the student picked one
 * of that category's suggested goals as-is, or wrote their own.
 * Recorded once, at creation, and never changed afterward.
 *
 * `outcome` — 'completed' | 'partially_completed' | 'try_again'.
 * Deliberately not a failure-oriented model (no "failed" state) —
 * these are learning-progress states, not grades, per explicit
 * product direction. Starts `null` (not yet recorded) until a
 * teacher or student actually records one.
 *
 * `reflection` is the STUDENT's own reflection on this goal
 * ("I could read faster today") — kept structurally separate from
 * `teacherObservations` on the owning session (a teacher's own
 * observation is evidence, not the student's reflection, per explicit
 * product direction) even though both may describe the same session.
 */
export function createProgrammeGoalEntry({ studentId, categoryId, text = '', source = 'custom', outcome = null, reflection = '' } = {}) {
  return {
    studentId,
    categoryId,
    text,
    source,
    outcome,
    reflection,
  };
}

/**
 * One activity that actually took place during this session — e.g.
 * "Guided Reading." A programme's own configuration may separately
 * list reusable activity *suggestions* (inside
 * `configuration.defaultComponents`/`extensions`, if modelled as a
 * component); this entry is always what a session's own history
 * says actually happened, never a reference back to a suggestion
 * that could itself change later.
 */
export function createActivityEntry({ name, notes = '' } = {}) {
  return {
    name,
    notes,
  };
}

/**
 * A teacher's own observation about one student during this session —
 * evidence, not the student's own reflection (see
 * createProgrammeGoalEntry's own header comment for why these stay
 * structurally separate). Mirrors models/Note.js's own small,
 * dated-entry shape.
 */
export function createTeacherObservationEntry({ studentId, note, recordedAt } = {}) {
  return {
    studentId,
    note,
    recordedAt: recordedAt || getCurrentIsoDate(),
  };
}
