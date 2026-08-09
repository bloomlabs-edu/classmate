/**
 * services/studentDeviceService.js
 *
 * The "trusted device" model behind the Student Portal's identity
 * flow — redesigned from an earlier, unbounded version (see this
 * project's CHANGELOG for the security review that led here). Still
 * not an identity system: no PIN, sign-in, or consent check lives in
 * here, and this file has no dependency on IdentityProvider,
 * ConsentProvider, or StudentLinkRepository. It's purely local
 * bookkeeping about which small set of students a *device* trusts.
 *
 * The model, in one paragraph: a device can hold up to
 * MAX_APPROVED_PROFILES approved student profiles, all from the same
 * classroom (e.g. two siblings sharing one family phone). The very
 * first profile ever added to a fresh device is free — that's normal
 * onboarding, already gated by the classroom's public student join
 * code (see StudentJoinClassroomView.js), and requiring anything more
 * for it would break the frictionless "enter code, pick your name,
 * done" flow this app has deliberately protected elsewhere. Every
 * profile *after* the first — or removing one — means the device is
 * already claimed by someone, so it requires the classroom's Device
 * Reset PIN (verified via workspaceService.verifyDeviceResetPin(),
 * which does touch Firestore — deliberately kept out of this file,
 * which stays pure localStorage). Switching between profiles already
 * approved on this device is always free; no PIN, ever.
 *
 * This file only enforces the *structural* rules (capacity, same-
 * classroom membership) and owns the storage. It does not know or
 * care whether a PIN was checked — callers (StudentDeviceFlow.js,
 * StudentManageProfilesView.js) are responsible for verifying the PIN
 * first when the situation calls for it, then calling
 * addApprovedProfile()/removeApprovedProfile() once that's done.
 */

const APPROVED_PROFILES_KEY = 'bloomLabsDeviceApprovedProfiles';
const ACTIVE_PROFILE_ID_KEY = 'bloomLabsDeviceActiveStudentId';

/** A device holds at most this many approved students at once — enough for a couple of siblings sharing a phone, small enough that a lost/found device can't accumulate an unbounded roster of names. */
export const MAX_APPROVED_PROFILES = 3;

function readApproved() {
  try {
    const raw = window.localStorage.getItem(APPROVED_PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('[studentDeviceService] Failed to read approved profiles:', error);
    return [];
  }
}

function writeApproved(profiles) {
  try {
    window.localStorage.setItem(APPROVED_PROFILES_KEY, JSON.stringify(profiles));
  } catch (error) {
    console.error('[studentDeviceService] Failed to save approved profiles:', error);
  }
}

/** Every student profile this device currently trusts (0 to MAX_APPROVED_PROFILES). */
export function getApprovedProfiles() {
  return readApproved();
}

/** True only for a completely fresh device — the one case where adding a profile needs no PIN. */
export function isFreshDevice() {
  return readApproved().length === 0;
}

/** True once a device already holds the maximum number of approved profiles. */
export function isAtCapacity() {
  return readApproved().length >= MAX_APPROVED_PROFILES;
}

/**
 * Adds a student to this device's trusted circle.
 *
 * Callers are responsible for PIN policy — see this file's header
 * comment. This function only enforces the structural rules and
 * trusts that the caller has already done whatever verification the
 * situation required (none, for a fresh device; a verified PIN,
 * otherwise).
 *
 * Returns { success: true } if the profile is now approved (including
 * if it already was — safe to call repeatedly), or
 * { success: false, reason: 'DIFFERENT_CLASSROOM' | 'AT_CAPACITY' }.
 */
/**
 * This profile's own stable slot number (0, 1, or 2).
 *
 * Self-healing for profiles approved before slotIndex existed: if one
 * is missing it, this assigns and persists a real one now — the same
 * "smallest unused slot" rule addApprovedProfile() uses — rather than
 * requiring a separate migration step for devices already in use.
 * Returns null if this studentId isn't an approved profile at all.
 */
export function getSlotForStudent(studentId) {
  const approved = readApproved();
  const profile = approved.find((p) => p.studentId === studentId);
  if (!profile) return null;

  if (typeof profile.slotIndex === 'number') return profile.slotIndex;

  const usedSlots = new Set(approved.filter((p) => typeof p.slotIndex === 'number').map((p) => p.slotIndex));
  const slotIndex = [0, 1, 2].find((slot) => !usedSlots.has(slot));
  writeApproved(approved.map((p) => (p.studentId === studentId ? { ...p, slotIndex } : p)));
  return slotIndex;
}

export function addApprovedProfile(studentRef) {
  const approved = readApproved();

  if (approved.some((p) => p.studentId === studentRef.studentId)) {
    return { success: true }; // already approved — no-op
  }

  if (approved.length > 0 && !approved.every((p) => p.classroomId === studentRef.classroomId)) {
    return { success: false, reason: 'DIFFERENT_CLASSROOM' };
  }

  if (approved.length >= MAX_APPROVED_PROFILES) {
    return { success: false, reason: 'AT_CAPACITY' };
  }

  // A stable, permanent slot number (0, 1, or 2) — the smallest one not
  // currently occupied by another approved profile, not this profile's
  // eventual array position. Array position shifts if a sibling ahead
  // of it is later removed; this field never does, once assigned. See
  // this file's own header comment on MAX_APPROVED_PROFILES for why
  // that distinction now matters: each slot will soon carry its own,
  // separate Firebase Auth identity (see studentAuthService.js) —
  // silently reassigning a student's slot would silently move them
  // onto a different identity too.
  const usedSlots = new Set(approved.map((p) => p.slotIndex));
  const slotIndex = [0, 1, 2].find((slot) => !usedSlots.has(slot));

  writeApproved([...approved, { ...studentRef, slotIndex }]);
  return { success: true };
}

/** Removes one profile from this device's trusted circle. Caller must already have verified the PIN — see this file's header comment. */
export function removeApprovedProfile(studentId) {
  writeApproved(readApproved().filter((p) => p.studentId !== studentId));
  if (getActiveProfile()?.studentId === studentId) {
    clearActiveProfile();
  }
}

/** Clears every approved profile on this device — e.g. re-provisioning it for a different classroom entirely. Caller must already have verified the PIN. */
export function clearAllApprovedProfiles() {
  writeApproved([]);
  clearActiveProfile();
}

/** Which approved profile is currently signed in on this device, or null. */
export function getActiveProfile() {
  try {
    const activeId = window.localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
    if (!activeId) return null;
    return readApproved().find((p) => p.studentId === activeId) || null;
  } catch (error) {
    console.error('[studentDeviceService] Failed to read active profile:', error);
    return null;
  }
}

/** Marks a profile as the one currently signed in — must already be an approved profile on this device. */
export function setActiveProfile(studentRef) {
  try {
    window.localStorage.setItem(ACTIVE_PROFILE_ID_KEY, studentRef.studentId);
  } catch (error) {
    console.error('[studentDeviceService] Failed to save active profile:', error);
  }
}

function clearActiveProfile() {
  try {
    window.localStorage.removeItem(ACTIVE_PROFILE_ID_KEY);
  } catch (error) {
    console.error('[studentDeviceService] Failed to clear active profile:', error);
  }
}
