/** Student-side data access for Learning Circle StudentEntry/goal documents. */

import * as studentAuthService from './studentAuthService.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as studentEntryRepository from '../repositories/firestoreStudentEntryRepository.js';
import * as enrollmentRepository from '../repositories/firestoreEnrollmentRepository.js';
import { pickSessionForDate } from './programmeSessionService.js';
import { collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function activeSlotAndDb() {
  const profile = studentDeviceService.getActiveProfile();
  if (!profile) return null;
  const slotIndex = studentDeviceService.getSlotForStudent(profile.studentId);
  if (slotIndex === null) return null;
  return { profile, slotIndex, db: studentAuthService.getFirestoreForSlot(slotIndex) };
}


export async function ensureProgrammeMembershipLink(classroomId, programmeId, studentId) {
  const context = activeSlotAndDb();
  if (!context) return false;
  const uid = await studentAuthService.ensureAnonymousSignIn(context.slotIndex);
  await enrollmentRepository.ensureLearningProgrammeMembershipLink(
    context.db, classroomId, programmeId, studentId, uid
  );
  return true;
}

export async function getOwnEntry(classroomId, sessionId) {
  const context = activeSlotAndDb();
  if (!context) return null;
  await studentAuthService.ensureAnonymousSignIn(context.slotIndex);
  return studentEntryRepository.getStudentEntry(context.db, classroomId, sessionId, context.profile.studentId);
}

export async function getOwnGoals(classroomId, sessionId) {
  const context = activeSlotAndDb();
  if (!context) return {};
  await studentAuthService.ensureAnonymousSignIn(context.slotIndex);
  const goals = await studentEntryRepository.listStudentGoals(context.db, classroomId, sessionId, context.profile.studentId);
  return Object.fromEntries(goals.map(({ categoryId, ...goal }) => [categoryId, goal]));
}

export async function setOwnGoal(classroomId, sessionId, categoryId, { text, source }) {
  const context = activeSlotAndDb();
  if (!context) return false;
  await studentAuthService.ensureAnonymousSignIn(context.slotIndex);
  await studentEntryRepository.createStudentEntryGoal(
    context.db,
    classroomId,
    sessionId,
    context.profile.studentId,
    categoryId,
    { text, source, outcome: null, reflection: '' }
  );
  return true;
}

/**
 * PHASE 3.7 — the write-side counterpart to getOwnGoals()/setOwnGoal()
 * above, generalized to match
 * ui/components/ProgrammeGoalsControls.js's own `goalWriter` contract
 * exactly: `isNewGoal` selects a full 4-key create
 * (studentEntryRepository.createStudentEntryGoal(), same as
 * setOwnGoal() already does) vs. a partial update patch (only the
 * keys actually changing, via updateStudentEntryGoal()) — never a
 * full overwrite that could reset a teacher-recorded outcome the
 * student's own write never touched. This is what lets
 * ui/student-portal/views/StudentLearningCircleView.js reuse
 * ProgrammeGoalsControls.js's own buildGoalPicker() directly, exactly
 * as it already did before this phase, with no changes to that shared
 * component's own student-facing behaviour.
 */
export async function persistOwnGoal(classroomId, sessionId, categoryId, valueOrPatch, isNewGoal) {
  const context = activeSlotAndDb();
  if (!context) return false;
  await studentAuthService.ensureAnonymousSignIn(context.slotIndex);
  if (isNewGoal) {
    await studentEntryRepository.createStudentEntryGoal(context.db, classroomId, sessionId, context.profile.studentId, categoryId, valueOrPatch);
  } else {
    await studentEntryRepository.updateStudentEntryGoal(context.db, classroomId, sessionId, context.profile.studentId, categoryId, valueOrPatch);
  }
  return true;
}

export async function listOwnSessionSummaries(classroomId, programmeId) {
  const context = activeSlotAndDb();
  if (!context) return [];
  await studentAuthService.ensureAnonymousSignIn(context.slotIndex);
  const indexRef = collection(context.db, 'classrooms', classroomId, 'learningProgrammes', programmeId, 'sessionIndex');
  const snapshot = await getDocs(query(indexRef, orderBy('date', 'asc')));
  const sessions = [];
  for (const item of snapshot.docs) {
    const sessionId = item.id;
    const entry = await studentEntryRepository.getStudentEntry(context.db, classroomId, sessionId, context.profile.studentId);
    const goals = entry ? await studentEntryRepository.listStudentGoals(context.db, classroomId, sessionId, context.profile.studentId) : [];
    sessions.push({
      id: sessionId,
      programmeId,
      date: item.data().date,
      attendance: { [context.profile.studentId]: entry?.attendance || null },
      goals: { [context.profile.studentId]: Object.fromEntries(goals.map(({ categoryId, ...goal }) => [categoryId, goal])) },
      usesStudentEntries: true,
    });
  }
  return sessions;
}

/**
 * PHASE 3.7 — the student-side equivalent of
 * services/programmeSessionService.js's own findSessionForDate(),
 * deliberately NOT calling that function: it queries the
 * classrooms/{id}/programmeSessions collection directly, which
 * requires the caller's uid to be in the classroom's own
 * `memberUids` — true for a teacher, never true for a student's own
 * per-slot anonymous identity (see
 * ui/student-portal/views/StudentLearningCircleView.js's own,
 * now-resolved header comment for the full history of this gap).
 * This function instead resolves "today's session" the same way
 * listOwnSessionSummaries() above already does — via sessionIndex and
 * this student's own studentEntries/goals documents, both of which
 * firestore.rules does authorize for a linked, active student — then
 * reuses programmeSessionService.js's own pure, Firestore-free
 * pickSessionForDate() to find the one matching `date`. Only ever
 * finds a session with `usesStudentEntries: true` (sessionIndex is
 * only ever written for one), which is exactly and only what a
 * student is now able to read at all — an old session, or no session
 * yet, both correctly resolve to `null` here.
 */
export async function getOwnSessionForDate(classroomId, programmeId, date) {
  const sessions = await listOwnSessionSummaries(classroomId, programmeId);
  return pickSessionForDate(sessions, date);
}
