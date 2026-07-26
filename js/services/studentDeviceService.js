/**
 * services/studentDeviceService.js
 *
 * The entire mechanism behind the new classroom-code student join
 * flow: not an identity system, just a browser remembering which
 * student profile(s) it last opened — the same shape as how a shared
 * TV remembers which streaming-service profile was last selected.
 * Deliberately separate from studentIdentityService.js, which remains
 * untouched and still backs the (now secondary) Google + PIN/
 * invitation-link parent flow — this file has no dependency on
 * IdentityProvider, ConsentProvider, or StudentLinkRepository at all,
 * and nothing in it should ever grow one. If a future authenticated-
 * parent-account layer is added, it belongs alongside this file, not
 * inside it — see this project's CHANGELOG for the architecture
 * discussion this implements.
 *
 * Stores a plain array of student refs — [{ classroomId, studentId,
 * studentName }] — in localStorage. No PIN, no token, no sign-in, no
 * consent check. A student ref here is nothing more than "this device
 * has looked at this profile before."
 */

const STORAGE_KEY = 'bloomLabsDeviceStudentProfiles';

function readProfiles() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('[studentDeviceService] Failed to read remembered profiles:', error);
    return [];
  }
}

function writeProfiles(profiles) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (error) {
    console.error('[studentDeviceService] Failed to save remembered profiles:', error);
  }
}

/** Every student profile this device has opened before. */
export function getRememberedProfiles() {
  return readProfiles();
}

/** Records that this device has opened a profile — safe to call repeatedly for the same student, it won't duplicate. */
export function rememberProfile(studentRef) {
  const profiles = readProfiles();
  if (profiles.some((ref) => ref.studentId === studentRef.studentId)) return;
  writeProfiles([...profiles, studentRef]);
}

/** Removes one profile from this device's remembered list — the "forget this device" affordance for a shared/handed-down device. */
export function forgetProfile(studentId) {
  writeProfiles(readProfiles().filter((ref) => ref.studentId !== studentId));
}

/** Clears every remembered profile on this device. */
export function forgetAllProfiles() {
  writeProfiles([]);
}

const LAST_ACTIVE_KEY = 'bloomLabsDeviceLastActiveStudent';

/** Which profile this device most recently used — lets a single-child device skip the picker and go straight in. */
export function getLastActiveProfile() {
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('[studentDeviceService] Failed to read last-active profile:', error);
    return null;
  }
}

export function setLastActiveProfile(studentRef) {
  try {
    window.localStorage.setItem(LAST_ACTIVE_KEY, JSON.stringify(studentRef));
  } catch (error) {
    console.error('[studentDeviceService] Failed to save last-active profile:', error);
  }
}
