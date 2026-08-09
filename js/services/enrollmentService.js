/**
 * services/enrollmentService.js
 *
 * Thin wrapper firestoreEnrollmentRepository.js sits behind — the UI
 * calls this, never the repository directly, matching this app's own
 * established "views own their content, services own data access"
 * split.
 */

import { generateJoinCode } from '../utils/idGenerator.js';
import * as enrollmentRepository from '../repositories/firestoreEnrollmentRepository.js';
import * as studentAuthService from './studentAuthService.js';
import * as studentDeviceService from './studentDeviceService.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — long enough for a teacher to hand a code to one student today, short enough that a stale, unused code doesn't linger indefinitely

/**
 * Which studentIds have already had their own enrollment confirmed
 * during THIS browser tab's session — in-memory only, never persisted,
 * same scope as studentPortalDataService.js's own
 * subscribedClassroomId/isClassroomSubscribed().
 *
 * Exists so main.js's own synchronous "classroom already subscribed,
 * skip onboarding resolution entirely" guard can also require
 * enrollment, without needing to make that guard (or renderRoute()
 * itself, called from many places) async just to await
 * isStudentEnrolled()'s own real Firestore read on every route
 * render. Set once, the first time enrollment is genuinely confirmed
 * for a student this session (see StudentDeviceFlow.js's own
 * resolveApprovedProfile()) — after that, this synchronous check is
 * enough; the underlying link itself doesn't change mid-session.
 */
const enrollmentConfirmedThisSession = new Set();

export function markEnrollmentConfirmed(studentId) {
  enrollmentConfirmedThisSession.add(studentId);
}

export function isEnrollmentConfirmedThisSession(studentId) {
  return enrollmentConfirmedThisSession.has(studentId);
}

/** Called from the Teacher Portal. Returns the real, human-shareable code. */
export async function generateEnrollmentToken(classroomId, studentId) {
  const token = generateJoinCode(); // same shape as the existing classroom/student join codes — 6 chars, no ambiguous characters
  await enrollmentRepository.createEnrollmentToken(token, {
    classroomId,
    studentId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  return token;
}

/**
 * Called from the Student Portal onboarding flow, once a name has
 * already been picked off the roster — so `studentId` here is known
 * from that step, never typed by the student themselves. Redeems the
 * given code specifically for that studentId's own device slot.
 *
 * Returns { success: true } or { success: false, reason }, where
 * reason is one of: 'NOT_FOUND', 'ALREADY_USED', 'EXPIRED',
 * 'WRONG_STUDENT' (the code is real but was issued for a different
 * student than the one this device just picked), or the real
 * Firestore error message if the batch commit itself is rejected —
 * per explicit product decision, that real error is surfaced, not
 * swallowed into a generic message.
 */
export async function redeemEnrollmentToken(token, { classroomId, studentId }) {
  const slotIndex = studentDeviceService.getSlotForStudent(studentId);
  if (slotIndex === null) {
    return { success: false, reason: 'NOT_APPROVED_ON_THIS_DEVICE' };
  }

  const db = studentAuthService.getFirestoreForSlot(slotIndex);

  // A real, specific client-side check first, purely for a better
  // error message to show the student — NOT the actual security
  // boundary. The real boundary is enforced server-side, in
  // firestore.rules, at the moment of the batch commit below,
  // regardless of what this read finds.
  const existingToken = await enrollmentRepository.getEnrollmentToken(db, token);
  if (!existingToken) return { success: false, reason: 'NOT_FOUND' };
  if (existingToken.used) return { success: false, reason: 'ALREADY_USED' };
  if (new Date(existingToken.expiresAt).getTime() < Date.now()) return { success: false, reason: 'EXPIRED' };
  if (existingToken.studentId !== studentId) return { success: false, reason: 'WRONG_STUDENT' };
  if (existingToken.classroomId !== classroomId) return { success: false, reason: 'WRONG_STUDENT' };

  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    await enrollmentRepository.redeemEnrollmentToken(db, token, { classroomId, studentId, uid });
    markEnrollmentConfirmed(studentId);
    return { success: true };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

/**
 * Links a device's own FIRST student — classroom code + picking a
 * name is treated as sufficient, no teacher-issued token needed. See
 * firestoreEnrollmentRepository.js's own createStudentAuthLinkDirect()
 * for the exact, explicitly-accepted security reasoning. Callers are
 * responsible for only using this for a device's actual first/sole
 * profile — see StudentDeviceFlow.js's own callers for the real
 * policy (a second or later profile on an already-claimed device
 * must go through redeemEnrollmentToken() instead).
 */
export async function linkFirstDeviceProfile(classroomId, studentId) {
  const slotIndex = studentDeviceService.getSlotForStudent(studentId);
  if (slotIndex === null) return false;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    await enrollmentRepository.createStudentAuthLinkDirect(db, classroomId, studentId, uid);
    markEnrollmentConfirmed(studentId);
    return true;
  } catch (error) {
    console.error('[enrollmentService] linkFirstDeviceProfile() failed:', error);
    return false;
  }
}

/** Whether this exact studentId already has a trusted link established, from this device's own point of view. Client-side convenience only — never used for authorization. */
export async function isStudentEnrolled(classroomId, studentId) {
  const slotIndex = studentDeviceService.getSlotForStudent(studentId);
  if (slotIndex === null) return false;
  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  await studentAuthService.ensureAnonymousSignIn(slotIndex);
  const link = await enrollmentRepository.getStudentAuthLink(db, classroomId, studentId);
  const enrolled = !!link;
  if (enrolled) markEnrollmentConfirmed(studentId);
  return enrolled;
}
