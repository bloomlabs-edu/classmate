/**
 * services/badgeService.js
 *
 * Manages a classroom's reusable badge catalog and the badges awarded to
 * individual students. Awarding a badge also logs a Participation
 * History entry (see services/timelineService.js), matching the
 * "Badge Awarded" timeline example in the brief. Revoking a badge only
 * removes the student's current badge status — the history entry stays,
 * since Participation History is an append-only record of what happened.
 */

import { logEntry } from './timelineService.js';

export function listCatalog(classroom) {
  return classroom.settings.badgeCatalog || [];
}

export function addBadgeToCatalog(classroom, name) {
  if (!classroom.settings.badgeCatalog) classroom.settings.badgeCatalog = [];
  const trimmed = name.trim();
  if (!trimmed) return false;

  const alreadyExists = classroom.settings.badgeCatalog.some(
    (badge) => badge.toLowerCase() === trimmed.toLowerCase()
  );
  if (alreadyExists) return false;

  classroom.settings.badgeCatalog.push(trimmed);
  return true;
}

export function removeBadgeFromCatalog(classroom, name) {
  const before = classroom.settings.badgeCatalog.length;
  classroom.settings.badgeCatalog = classroom.settings.badgeCatalog.filter((badge) => badge !== name);
  return classroom.settings.badgeCatalog.length < before;
}

/**
 * `meta` is an optional, purely-additive extension (Recognition/
 * Comments feature) — when a badge is awarded from a specific
 * notebook/assignment row's own quick-access control, the caller
 * passes `{ workItemRef }` (and, if a comment was attached in the same
 * action, `{ commentId }`) so the timeline entry preserves exactly
 * which piece of work this award was for — see
 * services/recognitionService.js's own header comment for the
 * `workItemRef` shape. Every pre-existing call site (Achievements tab's
 * "+ Award Badge", services/classModeService.js's own badge-award
 * rules) calls this with no third argument at all and is completely
 * unaffected: `meta` defaults to `{}`, so no new field is ever added to
 * a badge-timeline entry unless a caller actually supplies one.
 */
export function awardBadge(student, badgeName, meta = {}) {
  if (!student.badges) student.badges = [];
  if (student.badges.includes(badgeName)) return false;

  student.badges.push(badgeName);
  logEntry(student, { kind: 'badge', label: badgeName, delta: 0, ...meta });
  return true;
}

export function revokeBadge(student, badgeName) {
  const before = student.badges.length;
  student.badges = student.badges.filter((badge) => badge !== badgeName);
  return student.badges.length < before;
}
