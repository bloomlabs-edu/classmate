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
 *     `goals[studentId][categoryId].text` on a past session.
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
 * `attendance`, `goals`, and `teacherObservations` are STUDENT-KEYED
 * MAPS, not arrays — a Phase 1.6 hardening change, made specifically
 * so independent per-student updates can be persisted as targeted
 * Firestore field-path writes (e.g.
 * `updateDoc(ref, { 'attendance.<studentId>': {...} })`) without ever
 * touching another student's own entry. The original Phase 1 shape
 * stored these as plain arrays; a naive "read the array, find-or-
 * replace one entry, write the whole array back" UI pattern is a
 * genuine last-write-wins race between two concurrent facilitators
 * (Teacher A marking Student A present and Teacher B marking Student
 * B present, both starting from the same snapshot, with one's
 * full-array write clobbering the other's) — see this project's own
 * Phase 1.5 Live-Readiness Audit §12, risk 2. Keying by `studentId` at
 * the top level turns that same edit into a write of one specific
 * nested field, which Firestore's own `updateDoc()` already merges at
 * exactly that granularity, natively, with no transaction, lock, or
 * extra framework required — see
 * services/programmeSessionService.js's own `buildAttendancePatch()`/
 * `buildGoalPatch()`/`buildTeacherObservationPatch()`.
 *
 *   attendance: { [studentId]: { status, recordedAt } }
 *     — one status per student per session; a student can only be
 *     present/absent/late once per occurrence, so a single value per
 *     key is the correct, smallest shape here.
 *
 *   goals: { [studentId]: { [categoryId]: { text, source, outcome, reflection } } }
 *     — nested two levels deep, NOT flattened to `{ [studentId]: ...one goal }`,
 *     specifically because a student may have more than one goal in
 *     the same session (one per category — e.g. a Reading goal AND a
 *     Speaking goal the same day). This is not a new capability added
 *     here: services/programmeSessionService.js's own recordGoal()
 *     already only ever allowed one goal per (studentId, categoryId)
 *     pair per session, even back when the data lived in a flat array
 *     (see that function's own "replaces, never duplicates"
 *     behaviour). This restructuring changes the storage shape to
 *     match a Firestore field path exactly
 *     (`goals.<studentId>.<categoryId>`), not the underlying domain
 *     rule, which is unchanged.
 *
 *   teacherObservations: { [studentId]: [ { note, recordedAt }, ... ] }
 *     — a map to a per-student ARRAY, not a single value, since a
 *     teacher may genuinely leave more than one observation about the
 *     same student during one session (unlike attendance, which is
 *     inherently single-valued per student per occurrence). This
 *     still fully satisfies the concurrency requirement that actually
 *     matters here — one student's own observations never share a
 *     Firestore field path with another's — without losing the
 *     ability to record several notes about the same student.
 *
 * `studentId`/`categoryId` are no longer repeated INSIDE each entry's
 * own value the way they were in the original array shape — they are
 * now implied entirely by the map key(s) that value is stored under,
 * removing a redundant, driftable copy of the same fact.
 *
 * `activities` intentionally remains a plain array, unchanged from
 * Phase 1 — an activity is a session-wide fact ("Guided Reading
 * happened today"), never scoped to one specific student, so there is
 * no per-student race to guard against for this field at all.
 * `componentInstances` also remains unchanged — it was already a
 * plain map (`{ [componentId]: value }`), not an array, so it already
 * had this same field-level update property from Phase 1 onward.
 *
 * NO separate "participant roster" field is stored on a session, by
 * deliberate decision (Phase 1.6, per this project's own Learning
 * Programmes Hardening authorization, Issue 5) — see
 * services/learningProgrammeService.js's own wasStudentMemberOn() for
 * the reasoning: a session's own attendance/goals/observations already
 * identify exactly who participated, and whether a given studentId
 * was genuinely a programme member on that session's own date is a
 * fact fully derivable from that programme's own `memberships[]`
 * (their `joinedAt`/`leftAt` range), never something that needs its
 * own stored, driftable copy.
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
  attendance = {},
  goals = {},
  activities = [],
  componentInstances = {},
  teacherObservations = {},
  usesStudentEntries = false,
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
    // PHASE 3 — the explicit, permanent old/new session boundary.
    // Set once, at creation, never changed afterward. `false` (the
    // default) for every session that already existed before this
    // field was introduced, and for any session object built without
    // explicitly opting in — `true` only for a session
    // services/programmeSessionService.js's own buildNewSession()
    // deliberately creates going forward. Everything downstream
    // (attendance mirroring, which document goals are canonical in)
    // branches on THIS field, never on "does a studentEntries
    // document happen to exist" — an explicit flag, not an inference,
    // per this phase's own explicit "do not silently mix old and new
    // semantics" instruction. Immutable in practice: nothing in this
    // codebase ever assigns to `session.usesStudentEntries` after
    // this factory runs.
    usesStudentEntries,
    createdAt: resolvedCreatedAt,
    updatedAt: updatedAt || resolvedCreatedAt,
  };
}

/**
 * One student's attendance value for this exact session — stored
 * under `session.attendance[studentId]` (see this file's own header
 * comment for why attendance is a student-keyed map, not an array).
 * `studentId` is intentionally NOT part of this value's own shape —
 * it is the map key this value is stored under, never duplicated
 * inside it. `status` is left as a plain string (e.g. 'present' /
 * 'absent' / 'late') rather than a fixed enum here, matching this
 * app's own "model defines shape, a config/service layer owns the
 * fixed set of valid values" split (see models/WorkRequest.js's own
 * header comment) — Phase 1 does not build the UI that would need to
 * enforce a specific set, so this model does not invent one.
 */
export function createAttendanceEntry({ status, recordedAt } = {}) {
  return {
    status,
    recordedAt: recordedAt || getCurrentIsoDate(),
  };
}

/**
 * One student's own daily goal for one category within this exact
 * session — stored under `session.goals[studentId][categoryId]` (see
 * this file's own header comment for why goals are a two-level
 * student-then-category-keyed map, not an array). `studentId`/
 * `categoryId` are intentionally NOT part of this value's own shape —
 * both are implied by the two map keys this value is stored under.
 *
 * This is the Learning Programme domain's own goal shape, deliberately
 * NOT models/Goal.js and NOT built by extending
 * services/goalService.js's GoalCycle (see this project's own Learning
 * Programmes Audit Report §14, Risk #2, for exactly why those two
 * systems are semantically incompatible with this one). A GoalCycle
 * Goal is one persistent goal per category, ticked complete/incomplete
 * day by day; a ProgrammeSession goal is the opposite shape entirely —
 * a brand new entry created fresh for each session, whose `text` is a
 * permanent snapshot of whatever the student actually chose or wrote
 * that day. No permanent "student goal" entity exists anywhere for
 * this system; tomorrow's goal is simply a new entry in tomorrow's own
 * session.
 *
 * `categoryId` (the map key this value lives under) references a
 * category inside the owning programme's own
 * `configuration.goalFramework.categories` — resolved live for
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
export function createProgrammeGoalEntry({ text = '', source = 'custom', outcome = null, reflection = '' } = {}) {
  return {
    text,
    source,
    outcome,
    reflection,
  };
}

/**
 * One activity that actually took place during this session — e.g.
 * "Guided Reading." Session-wide, not scoped to one student — see
 * this file's own header comment for why `activities` stays a plain
 * array, unlike attendance/goals/teacherObservations. A programme's
 * own configuration may separately list reusable activity
 * *suggestions* (inside `configuration.defaultComponents`/
 * `extensions`, if modelled as a component); this entry is always
 * what a session's own history says actually happened, never a
 * reference back to a suggestion that could itself change later.
 */
export function createActivityEntry({ name, notes = '' } = {}) {
  return {
    name,
    notes,
  };
}

/**
 * One teacher observation about one student during this session —
 * stored under `session.teacherObservations[studentId]`, appended to
 * that student's own array of observations (see this file's own
 * header comment for why teacherObservations is a student-keyed map
 * of arrays, not a flat array). `studentId` is intentionally NOT part
 * of this value's own shape — it is implied by the map key this
 * array lives under. Evidence, not the student's own reflection (see
 * createProgrammeGoalEntry's own header comment for why these stay
 * structurally separate). Mirrors models/Note.js's own small,
 * dated-entry shape.
 */
export function createTeacherObservationEntry({ note, recordedAt } = {}) {
  return {
    note,
    recordedAt: recordedAt || getCurrentIsoDate(),
  };
}
