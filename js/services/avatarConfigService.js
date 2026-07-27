/**
 * services/avatarConfigService.js
 *
 * Phase 1 of the avatar system (see this project's CHANGELOG for the
 * two-phase decision): avatar configuration lives in this device's
 * localStorage only, keyed per student — never written to Firestore.
 *
 * This is a deliberate, temporary scope limit, not an oversight: a
 * student device has no Firebase Auth, and the one write path that
 * does exist for an unauthenticated device today
 * (workspaceService.markStudentJoinedPortal()) already fails under
 * real Firestore rules and is caught/ignored (see that function's own
 * doc comment). Building the avatar *picker* on top of that same
 * silently-failing write path would be worse than not having
 * customization at all — a student could pick a look, see it work,
 * and lose it with no visible error the next time they open the app
 * on a different device.
 *
 * Phase 2 (once student write permissions are implemented — see the
 * open `hasJoinedPortal` TODO) will add a sync step that pushes
 * whatever's in localStorage up to the student's Firestore record,
 * and this file is the one place that change will happen — every
 * caller here (the avatar builder, Profile, Team) already goes
 * through getAvatarConfig()/saveAvatarConfig() rather than touching
 * localStorage directly, so Phase 2 is additive, not a rewrite.
 *
 * A student's own device is always the source of truth for their own
 * avatar in Phase 1. Other students' avatars are only ever visible on
 * this device if they were also customized on this same device (e.g.
 * a shared family device) — everywhere else in the Portal that shows
 * someone else's avatar (teammates, the roster picker) simply falls
 * back to the existing initials avatar when no local config exists,
 * which is the honest, correct behavior for data this device
 * genuinely doesn't have yet.
 */

import { DEFAULT_AVATAR_CONFIG, isValidAvatarConfig } from '../config/avatarOptions.js';

const STORAGE_KEY_PREFIX = 'classmate:avatarConfig:';

function keyFor(studentId) {
  return `${STORAGE_KEY_PREFIX}${studentId}`;
}

/** Returns the saved config for this studentId, or null if this device has never saved one. */
export function getAvatarConfig(studentId) {
  if (!studentId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(studentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidAvatarConfig(parsed) ? parsed : null;
  } catch (error) {
    console.warn('[avatarConfigService] Failed to read avatar config:', error);
    return null;
  }
}

/** Returns the saved config, or the default avatar if this device hasn't saved one yet — for "self" contexts where something should always render. */
export function getAvatarConfigOrDefault(studentId) {
  return getAvatarConfig(studentId) || DEFAULT_AVATAR_CONFIG;
}

/** Phase 1: writes to localStorage only. Returns true on success, false if storage is unavailable (private browsing, quota, etc.) — callers should still update in-memory state either way so the current session reflects the change. */
export function saveAvatarConfig(studentId, config) {
  if (!studentId || !isValidAvatarConfig(config)) return false;
  try {
    window.localStorage.setItem(keyFor(studentId), JSON.stringify(config));
    return true;
  } catch (error) {
    console.warn('[avatarConfigService] Failed to save avatar config (Phase 1 is local-only):', error);
    return false;
  }
}
