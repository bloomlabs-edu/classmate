/**
 * services/classroomService.js
 *
 * Holds the in-memory list of Classrooms the signed-in teacher belongs
 * to (as owner or teacher) and exposes classroom-level operations
 * (create, update, delete, list, and importing a roster into an
 * already-created classroom). workspaceService is responsible for
 * loading/persisting this list via Firestore — this module only manages
 * it in memory and builds new records.
 *
 * Each classroom now arrives from its own independent Firestore
 * listener (one per classroom the teacher belongs to — see
 * workspaceService.js), rather than one batch read of "all my
 * classrooms" — so this module updates one classroom at a time
 * (upsertClassroom/removeClassroomFromMemory) instead of replacing the
 * whole list at once.
 */

import { createClassroom } from '../models/Classroom.js';
import { createTeam } from '../models/Team.js';
import { createStudent } from '../models/Student.js';
import { getDefaultGroupColor } from '../config/groupColorConfig.js';
import { isNonEmptyString } from '../utils/validators.js';
import { buildDefaultSettings } from '../config/classroomDefaults.js';
import { DEFAULT_BADGE_CATALOG } from '../config/badgeConfig.js';
import * as memberService from './memberService.js';
import { MEMBER_ROLES } from '../config/memberRoles.js';
import * as notebookService from './notebookService.js';
import { generateJoinCode, generateDeviceResetPin } from '../utils/idGenerator.js';

export class ClassroomValidationError extends Error {}

function validateDetails(details) {
  if (!isNonEmptyString(details?.schoolName)) {
    throw new ClassroomValidationError('School Name is required.');
  }
  if (!isNonEmptyString(details?.gradeSection)) {
    throw new ClassroomValidationError('Grade / Section is required.');
  }
  // Curriculum was required here for a period (the "Curriculum
  // Assignment at Creation" milestone) — reverted per explicit product
  // decision (see ui/components/NewClassroomModal.js's own header
  // comment for the full reasoning). curriculumAssignment stays
  // optional: null is a normal, already-handled state throughout this
  // app (see models/Classroom.js's own default, and
  // services/curriculumLibraryService.js's getCurriculumAssignment()),
  // and ui/views/AssignCurriculumPromptView.js already exists to let a
  // teacher assign one later.
}

/**
 * Backfills fields onto a classroom (and its teams/students/settings)
 * that may not exist yet on data saved by an earlier version of this
 * app — e.g. a classroom saved before Learning Activities, the badge
 * catalog, per-student notes/badges/history, or (as of this phase)
 * real membership existed. Without this, loading old data throws deep
 * inside rendering the moment a screen that needs a newer field opens,
 * which looks like "nothing happens" rather than a clear error.
 */
function normalizeClassroom(classroom) {
  const defaults = buildDefaultSettings();

  classroom.members = classroom.members || {};
  classroom.memberUids = classroom.memberUids || Object.keys(classroom.members);
  classroom.ownerUid = classroom.ownerUid ?? null;

  classroom.teams = (classroom.teams || []).map(normalizeTeam);
  classroom.learningActivities = classroom.learningActivities || [];
  classroom.notebookConfig = classroom.notebookConfig || { subjects: [], notebookTypes: [] };
  classroom.notebookConfig.subjects = classroom.notebookConfig.subjects || [];
  classroom.notebookConfig.notebookTypes = classroom.notebookConfig.notebookTypes || [];
  // Legacy, pre-timeline shape — left in place, unused, read only once by
  // the migration fold below.
  classroom.notebookCheckTemplates = classroom.notebookCheckTemplates || {};
  classroom.notebookChecks = classroom.notebookChecks || {};
  classroom.notebooks = classroom.notebooks || {};
  notebookService.migrateLegacyChecksIfNeeded(classroom);
  classroom.classroomJoinCode = classroom.classroomJoinCode ?? null;
  classroom.currentScoringPeriodStartedAt = classroom.currentScoringPeriodStartedAt ?? null;

  classroom.settings = classroom.settings || {};
  classroom.settings.bucketScoring = classroom.settings.bucketScoring || defaults.bucketScoring;
  classroom.settings.scoring = classroom.settings.scoring || defaults.scoring;
  classroom.settings.badgeCatalog = classroom.settings.badgeCatalog || [...DEFAULT_BADGE_CATALOG];
  classroom.settings.setupProgress = classroom.settings.setupProgress || defaults.setupProgress;

  return classroom;
}

function normalizeTeam(team) {
  team.color = team.color ?? null;
  team.students = (team.students || []).map(normalizeStudent);
  return team;
}

function normalizeStudent(student) {
  student.score = student.score ?? 0;
  student.bucket = student.bucket ?? null;
  student.badges = student.badges || [];
  student.notes = student.notes || [];
  student.submissions = student.submissions || {};
  student.history = student.history || [];
  return student;
}

let classrooms = [];

/** Inserts or replaces one classroom in memory — the unit a Firestore listener delivers. */
export function upsertClassroom(classroomData) {
  const normalized = normalizeClassroom(classroomData);
  const index = classrooms.findIndex((classroom) => classroom.id === normalized.id);
  if (index === -1) {
    classrooms.push(normalized);
  } else {
    classrooms[index] = normalized;
  }
  return normalized;
}

/** Removes one classroom from memory (e.g. deleted, or this teacher lost access). */
export function removeClassroomFromMemory(classroomId) {
  classrooms = classrooms.filter((classroom) => classroom.id !== classroomId);
}

/** Clears everything — used on sign-out. */
export function clearAllClassrooms() {
  classrooms = [];
}

export function listClassrooms() {
  return classrooms;
}

export function getClassroomById(id) {
  return classrooms.find((classroom) => classroom.id === id) || null;
}

/**
 * Creates a classroom with only its details (School Name, Grade /
 * Section required; Classroom Name, Academic Year, Description
 * optional) — no teams yet. `owner` is the creating teacher's safe
 * profile ({ uid, displayName }); they're stamped as this classroom's
 * owner and sole member. The Setup Wizard (see
 * ui/views/SetupWizardView.js) handles importing students, buckets,
 * groups, and scoring afterwards, so every classroom is created this
 * same way regardless of how it'll eventually get its roster.
 */
export function createEmptyClassroom(details, owner) {
  validateDetails(details);
  const classroom = createClassroom({ ...details, ownerUid: owner.uid });
  memberService.addMember(classroom, owner.uid, MEMBER_ROLES.OWNER, owner.displayName);
  // Generated here, at creation time, specifically so nothing ever
  // needs to lazily backfill-and-save a join code as a side effect of
  // rendering the Teachers section later — that pattern (a render
  // function performing a write) was the actual root cause of a real
  // render re-entrancy bug (see this project's CHANGELOG). A render
  // function should only ever read; this is where the write belongs.
  ensureJoinCode(classroom);
  ensureStudentJoinCode(classroom);
  classrooms.push(classroom);
  return classroom;
}

/**
 * Adds teams and students, parsed from a CSV (see
 * services/classroomImportService.js), to an *existing* classroom —
 * used by the Setup Wizard's Import Students step. Every new team gets
 * the next default colour in rotation (see config/groupColorConfig.js);
 * every student starts with score 0 and no bucket assigned (buckets are
 * handled as a separate wizard step, even when the CSV contained bucket
 * data — see services/bucketService.js).
 */
export function importRoster(classroom, teamsWithStudentNames) {
  const startIndex = classroom.teams.length;

  const newTeams = teamsWithStudentNames.map((teamDef, index) =>
    createTeam({
      name: teamDef.name,
      color: getDefaultGroupColor(startIndex + index),
      students: teamDef.students.map((studentName) => createStudent({ name: studentName })),
    })
  );

  classroom.teams.push(...newTeams);
  return newTeams;
}

/**
 * Merges `updates` into an existing classroom's details (schoolName,
 * gradeSection, classroomName, academicYear, description) and
 * re-validates. Throws ClassroomValidationError if the merged result
 * would be missing a required field (e.g. clearing School Name).
 */
export function updateClassroomDetails(id, updates) {
  const classroom = getClassroomById(id);
  if (!classroom) return null;

  const merged = { ...classroom, ...updates };
  validateDetails(merged);
  Object.assign(classroom, updates);
  return classroom;
}

export function deleteClassroom(id) {
  const before = classrooms.length;
  classrooms = classrooms.filter((classroom) => classroom.id !== id);
  return classrooms.length < before;
}

/**
 * The name to show prominently throughout the app: the teacher-defined
 * Classroom Name when one was provided, otherwise the Grade / Section.
 */
export function getDisplayName(classroom) {
  return classroom.classroomName || classroom.gradeSection;
}

/**
 * A secondary line of context to show under the display name — e.g.
 * "Grade 8A • CHS Kannamapet" when a Classroom Name is set (so the grade
 * and school aren't lost), or just the school name when the Grade /
 * Section is already doing double duty as the display name.
 */
export function getDisplaySubtitle(classroom) {
  if (classroom.classroomName) {
    return `${classroom.gradeSection} \u2022 ${classroom.schoolName}`;
  }
  return classroom.schoolName;
}

/** Total number of students across every team in a classroom. */
export function getStudentCount(classroom) {
  return classroom.teams.reduce((sum, team) => sum + team.students.length, 0);
}

/** Total number of members (owner + teachers) in a classroom. */
export function getMemberCount(classroom) {
  return classroom.memberUids?.length || 0;
}

/**
 * Lazily backfills a join code for classrooms created before this
 * feature existed — models/Classroom.js's `classroomJoinCode` field has
 * existed as a reserved placeholder (always null) since before real
 * membership existed; this is where it actually gets populated.
 * Returns true if it generated a new code (so the caller knows to
 * persist the classroom), false if one already existed.
 */
export function ensureJoinCode(classroom) {
  if (classroom.classroomJoinCode) return false;
  classroom.classroomJoinCode = generateJoinCode();
  return true;
}

/**
 * Same reasoning as ensureJoinCode() above, for the separate
 * student-facing code — deliberately a different code, since a code
 * that can add a co-teacher must never be the same one posted on a
 * classroom board or shared over WhatsApp for students to enter.
 */
export function ensureStudentJoinCode(classroom) {
  if (classroom.classroomStudentJoinCode) return false;
  classroom.classroomStudentJoinCode = generateJoinCode();
  return true;
}

/**
 * Same lazy-generation pattern as the two functions above, for the
 * Device Reset PIN that gates changes to a device's trusted-profile
 * set (see services/studentDeviceService.js and models/Classroom.js's
 * doc comment on `deviceResetPin` for the full reasoning). A short
 * numeric PIN, not a join code — see utils/idGenerator.js's
 * generateDeviceResetPin().
 */
export function ensureDeviceResetPin(classroom) {
  if (classroom.deviceResetPin) return false;
  classroom.deviceResetPin = generateDeviceResetPin();
  return true;
}

/**
 * A teacher-initiated rotation — e.g. the PIN was shared too widely,
 * or a new school year should start clean. Always generates a new
 * value, unlike ensureDeviceResetPin() which only fills in a missing
 * one.
 */
export function regenerateDeviceResetPin(classroom) {
  classroom.deviceResetPin = generateDeviceResetPin();
}

/**
 * Every other feature in this app (Class Mode, Recognition, Notebook
 * Tracker, Reports, Weekly Snapshot) already reads students via
 * classroom.teams.flatMap(t => t.students) — rewriting that
 * assumption across the whole app would be a much larger, riskier
 * change than this feature needs. Instead, a single reserved team
 * (isUngrouped: true) holds any student the teacher hasn't assigned
 * to a real group, created lazily the first time it's needed and
 * reused after that. Structurally identical to any other team, so
 * nothing downstream needs special-casing — only UI that lists
 * teacher-created groups (Settings' Groups tab, the Dashboard's
 * Groups widget) needs to filter it out, since it isn't one.
 */
export function getOrCreateUngroupedTeam(classroom) {
  const existing = classroom.teams.find((team) => team.isUngrouped);
  if (existing) return existing;

  const ungroupedTeam = { ...createTeam({ name: 'Ungrouped' }), isUngrouped: true };
  classroom.teams.push(ungroupedTeam);
  return ungroupedTeam;
}
