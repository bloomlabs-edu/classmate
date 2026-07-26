/**
 * services/studentIdentityService.js
 *
 * The ONLY thing the Student Portal should ever import for identity —
 * per the stated philosophy, Google (or any future provider) answers
 * "who is this user," this service answers "which student(s) is this
 * user linked to." No Student Portal screen should ever import
 * Firebase Auth, Firestore, or any repository directly; every screen
 * calls through here instead:
 *
 *   const student = await studentIdentityService.getCurrentStudent();
 *
 * This module composes three swappable pieces — an IdentityProvider,
 * a ConsentProvider, and a StudentLinkRepository. The sign-in and
 * consent pieces are still demo/placeholder implementations pending
 * real Google Auth and the AI Working Committee's consent review —
 * but the link repository is now genuinely generic over any real
 * classroom's real students (see LocalStudentLinkRepository.js),
 * not a fixed fictional roster. Swapping in GoogleIdentityProvider and
 * a real ConsentProvider later is still the only remaining change
 * needed for full production readiness; nothing about student linking
 * itself is a placeholder anymore.
 */

import { DemoIdentityProvider } from './identity/DemoIdentityProvider.js';
import { DemoConsentProvider } from './identity/DemoConsentProvider.js';
import { LocalStudentLinkRepository } from '../repositories/identity/LocalStudentLinkRepository.js';

// The one place this whole architecture's concrete providers are
// chosen. A production build changes exactly these three lines.
const identityProvider = new DemoIdentityProvider();
const consentProvider = new DemoConsentProvider();
const linkRepository = new LocalStudentLinkRepository();

/**
 * The Student Portal's main entry point. Resolves to a student ref —
 * { classroomId, studentId, studentName } — if a signed-in provider
 * user is already linked to (at least) one student, preferring the
 * last-selected one; resolves to null if no one is signed in, or if
 * the signed-in user has no linked students yet (either case means
 * the onboarding UI needs to run — see
 * ui/student-portal/onboarding/StudentOnboardingFlow.js).
 */
export async function getCurrentStudent() {
  const providerUser = identityProvider.getCurrentProviderUser();
  if (!providerUser) return null;

  const linkedStudents = await linkRepository.getLinkedStudents(providerUser.id);
  if (linkedStudents.length === 0) return null;
  if (linkedStudents.length === 1) return linkedStudents[0];

  const lastSelected = await linkRepository.getLastSelectedStudent(providerUser.id);
  return lastSelected || linkedStudents[0];
}

export async function signIn() {
  return identityProvider.signIn();
}

export async function signOut() {
  return identityProvider.signOut();
}

export function getCurrentProviderUser() {
  return identityProvider.getCurrentProviderUser();
}

/** Every student currently linked to the signed-in provider user — used by the "Who's learning today?" picker. */
export async function listLinkedStudents() {
  const providerUser = identityProvider.getCurrentProviderUser();
  if (!providerUser) return [];
  return linkRepository.getLinkedStudents(providerUser.id);
}

/**
 * Links the signed-in provider user to whichever student the PIN
 * belongs to. Resolves the student ref on success; resolves null if
 * the PIN doesn't match any student. Consent is checked (and, on a
 * real ConsentProvider, would be requested) before the link is
 * created — see ConsentProvider.js's own doc comment on why this
 * check exists today but isn't load-bearing yet.
 */
export async function linkWithPin(pin) {
  const providerUser = identityProvider.getCurrentProviderUser();
  if (!providerUser) throw new Error('Cannot link a student before signing in.');

  const studentRef = await linkRepository.resolvePin(pin);
  if (!studentRef) return null;

  const consented = (await consentProvider.hasConsent(providerUser.id, studentRef)) || (await consentProvider.requestConsent(providerUser.id, studentRef));
  if (!consented) return null;

  await linkRepository.linkStudent(providerUser.id, studentRef);
  await linkRepository.setLastSelectedStudent(providerUser.id, studentRef);
  return studentRef;
}

/** Same as linkWithPin(), but for a one-time invitation token — see repositories/identity/StudentLinkRepository.js's redeemInvitationToken() for why this is a single atomic operation (a token must never be redeemable twice). */
export async function linkWithInvitationToken(token) {
  const providerUser = identityProvider.getCurrentProviderUser();
  if (!providerUser) throw new Error('Cannot link a student before signing in.');

  const resolved = await linkRepository.resolveInvitationToken(token);
  if (!resolved) return null;

  const consented = (await consentProvider.hasConsent(providerUser.id, resolved)) || (await consentProvider.requestConsent(providerUser.id, resolved));
  if (!consented) return null;

  const studentRef = await linkRepository.redeemInvitationToken(providerUser.id, token);
  if (studentRef) {
    await linkRepository.setLastSelectedStudent(providerUser.id, studentRef);
  }
  return studentRef;
}

/** Switches which linked student is "active" — used by the Portal's own student-switcher (see the Profile view) and the "Who's learning today?" picker. */
export async function selectStudent(studentRef) {
  const providerUser = identityProvider.getCurrentProviderUser();
  if (!providerUser) throw new Error('Cannot select a student before signing in.');
  await linkRepository.setLastSelectedStudent(providerUser.id, studentRef);
}

export function onProviderAuthStateChange(callback) {
  return identityProvider.onAuthStateChange(callback);
}

/** Teacher-side (Classroom Tracker) — generates a fresh PIN for a student. Teachers never choose or type one themselves. Works for any real classroom student — see LocalStudentLinkRepository.js's own doc comment on why studentName is passed in rather than looked up. */
export async function generatePinForStudent(classroomId, studentId, studentName) {
  return linkRepository.generatePin(classroomId, studentId, studentName);
}

/** Teacher-side — creates a single-use, expiring invitation link token for a student. Works for any real classroom student. */
export async function generateInvitationTokenForStudent(classroomId, studentId, studentName, expiryDays = 7) {
  return linkRepository.generateInvitationToken(classroomId, studentId, studentName, expiryDays);
}

/** The current PIN for a student, or null if one hasn't been generated yet — lets Student Access show "no PIN yet" versus a real value. */
export function getCurrentPinForStudent(studentId) {
  return linkRepository.getCurrentPin(studentId);
}

/** Whether any parent account is currently linked to this student — powers Student Access's connection-status-first view. */
export async function isStudentLinked(classroomId, studentId) {
  return linkRepository.isStudentLinked(classroomId, studentId);
}

/** Whether any invitation has ever been sent for this classroom — used by setupStateService.js, independent of whether anyone has actually linked yet. */
export async function hasSentAnyInvitation(classroom) {
  return linkRepository.hasAnyInvitationForClassroom(classroom.id);
}

/**
 * Whether ANY student across the whole classroom has a linked parent
 * yet — powers the Dashboard's first-time onboarding card (see
 * ui/views/DashboardView.js), which should disappear the moment at
 * least one family has connected. Reuses isStudentLinked() per student
 * rather than duplicating its logic against the repository directly.
 */
export async function hasAnyLinkedStudent(classroom) {
  const allStudents = classroom.teams.flatMap((team) => team.students);
  for (const student of allStudents) {
    if (await isStudentLinked(classroom.id, student.id)) {
      return true;
    }
  }
  return false;
}
