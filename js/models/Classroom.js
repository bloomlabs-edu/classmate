/**
 * models/Classroom.js
 *
 * Describes the shape of a Classroom — the top-level entity a teacher
 * creates or imports. Now a *shared* entity: it lives at
 * classrooms/{id} in Firestore (not nested under a single owner's uid),
 * so any member listed in `members` can read and edit it, and every
 * connected member's device sees changes in real time via the same
 * document — never a per-teacher copy (see
 * repositories/firestoreClassroomRepository.js and
 * services/workspaceService.js).
 *
 * Fields:
 *   id             - unique identifier, also the Firestore document id
 *   schoolName     - required, e.g. "CHS Kannamapet"
 *   gradeSection   - required, e.g. "Grade 8A", "Science Club"
 *   classroomName  - optional, a teacher-defined friendly name, e.g.
 *                    "Bloom Force 19". Shown prominently throughout the
 *                    app when present (see classroomService.getDisplayName);
 *                    falls back to gradeSection when absent.
 *   academicYear   - optional, e.g. "2026–27"
 *   description    - optional free-text notes
 *   createdAt      - ISO date string
 *   ownerUid       - the Firebase UID of the classroom's owner (set once,
 *                    at creation; transferring ownership is a future
 *                    feature — see config/memberRoles.js)
 *   members        - { [uid]: { role, displayName, joinedAt } } — real,
 *                    Google-authenticated membership (see
 *                    services/memberService.js). displayName is stored
 *                    here because this app has no way to look up another
 *                    account's profile — only a signed-in user's own
 *                    safe profile (uid/displayName) is ever available.
 *   memberUids     - the same uids as `members`' keys, kept in sync, as
 *                    a plain array. Firestore can't query "which
 *                    documents have my uid as a map key", so this array
 *                    exists purely so security rules and any future
 *                    "classrooms I can access" query can use a simple,
 *                    fast `uid in memberUids` check.
 *   teams          - Team[] (see models/Team.js)
 *   learningActivities - LearningActivity[] (see models/LearningActivity.js),
 *                    created once per classroom; each student then gets
 *                    a status against each one (see models/Student.js)
 *   notebookConfig - { subjects: [{id, name}], notebookTypes: [{id,
 *                    subjectId, name}] } — the classroom's configurable
 *                    notebook taxonomy (see
 *                    services/notebookConfigService.js). Kept separate
 *                    from `notebooks` since this is near-static setup,
 *                    edited from Settings, not accumulated day by day.
 *   notebooks      - { [subjectId]: { [notebookTypeId]: { [dateKey]:
 *                    { [studentId]: NotebookSubmission } } } } (see
 *                    services/notebookService.js and
 *                    models/NotebookSubmission.js) — Notebook Tracker's
 *                    day-by-day register. No discrete "check" entity:
 *                    a teacher opens a notebook, today's date is
 *                    selected automatically, and marking a student
 *                    writes directly under that date. Subject-first,
 *                    matching how a teacher actually thinks about it
 *                    ("English's Handwriting notebook, today").
 *   notebookCheckTemplates, notebookChecks - LEGACY, pre-timeline
 *                    shape. Left in place, unused, read only once by
 *                    services/notebookService.js's one-time,
 *                    non-destructive migration into `notebooks` (see
 *                    that file) — never written to again.
 *   classroomJoinCode - RESERVED, always null today. A future
 *                    student/parent joining flow (Class Code or QR)
 *                    would populate this and a not-yet-built
 *                    membershipRequestService would redeem it into a
 *                    real `members` entry via memberService.addMember()
 *                    — the same function teachers are added through
 *                    today. No generator, no redemption logic, and no UI
 *   classroomStudentJoinCode - a second, separately-scoped code for
 *                    students to join the Portal directly (enter code
 *                    -> see the real roster -> tap their own name),
 *                    with no PIN, sign-in, or account of any kind
 *                    behind it. Deliberately a different code from
 *                    classroomJoinCode above — that one can add someone
 *                    as a co-teacher; this one only ever resolves to a
 *                    read-only roster view, and must never be
 *                    interchangeable with the co-teacher code.
 *                    exist yet; this field exists purely so that future
 *                    work is additive (fill in a value and wire up a
 *                    service) rather than a schema change. See
 *                    config/memberRoles.js's STUDENT/PARENT roles for
 *                    the matching placeholder on the membership side —
 *                    both are blocked pending the same authentication
 *                    approval.
 *   settings       - classroom-level settings: bucket scoring, point
 *                    scoring, badge catalog, and Setup Wizard progress —
 *                    see config/classroomDefaults.js for the defaults,
 *                    built fresh for every classroom (never a shared
 *                    reference)
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { buildDefaultSettings } from '../config/classroomDefaults.js';

export function createClassroom({
  id,
  schoolName,
  gradeSection,
  classroomName = '',
  academicYear = '',
  description = '',
  createdAt,
  ownerUid = null,
  members = {},
  memberUids = [],
  teams = [],
  learningActivities = [],
  notebookConfig = { subjects: [], notebookTypes: [] },
  notebooks = {},
  notebookCheckTemplates = {},
  notebookChecks = {},
  classroomJoinCode = null,
  classroomStudentJoinCode = null,
  settings = buildDefaultSettings(),
} = {}) {
  return {
    id: id || generateId(),
    schoolName,
    gradeSection,
    classroomName,
    academicYear,
    description,
    createdAt: createdAt || getCurrentIsoDate(),
    ownerUid,
    members,
    memberUids,
    teams,
    learningActivities,
    notebookConfig,
    notebooks,
    notebookCheckTemplates,
    notebookChecks,
    classroomJoinCode,
    classroomStudentJoinCode,
    settings,
  };
}
