/**
 * services/notebookBadgeService.js
 *
 * Manages the Notebook Tracker's own compact achievement badge catalog
 * (see config/notebookBadgeConfig.js) and how many times each has been
 * earned per student. Deliberately separate from services/badgeService.js's
 * Behaviour Badges: that system is presence-only (a student either has
 * "Leadership" or doesn't — see awardBadge()'s own no-op-if-already-
 * present check), while these badges are explicitly repeatable
 * ("Organization" earned 4 times) — the two cannot share one data shape
 * without changing badgeService.js's existing, working semantics for
 * every other screen that already depends on it (Student Profile,
 * Class Mode, Recognition). Mirrors that file's own catalog
 * add/list shape and services/timelineService.js's own history-logging
 * convention on award, so the two systems still feel like one family,
 * not two unrelated inventions.
 */

import { generateId } from '../utils/idGenerator.js';
import { logEntry } from './timelineService.js';

const THEME_CYCLE = ['amber', 'blue', 'green', 'purple'];

/** Every badge type available in this classroom — the 3 seed types plus any teacher-added ones, in creation order. */
export function listBadgeTypes(classroom) {
  return classroom.settings.notebookBadgeTypes || [];
}

export function getBadgeTypeById(classroom, badgeTypeId) {
  return listBadgeTypes(classroom).find((type) => type.id === badgeTypeId) || null;
}

/**
 * Adds a new, teacher-defined badge type to this classroom only — never
 * the shared DEFAULT_NOTEBOOK_BADGE_TYPES array itself (same
 * "fresh copy per classroom" principle as badgeService.addBadgeToCatalog()).
 * `icon` defaults to a generic 'award' glyph and `theme` auto-cycles
 * through the 4 existing BADGE_THEMES keys (by current catalog size) —
 * this feature's own "+ Add Badge Type" action only ever collects a
 * name, not a full icon/colour picker; a distinct colour per type is
 * still guaranteed without one.
 */
export function addBadgeType(classroom, name) {
  if (!classroom.settings.notebookBadgeTypes) classroom.settings.notebookBadgeTypes = [];
  const trimmed = (name || '').trim();
  if (!trimmed) return null;

  const catalog = classroom.settings.notebookBadgeTypes;
  const alreadyExists = catalog.some((type) => type.name.toLowerCase() === trimmed.toLowerCase());
  if (alreadyExists) return null;

  const newType = {
    id: generateId(),
    name: trimmed,
    icon: 'award',
    theme: THEME_CYCLE[catalog.length % THEME_CYCLE.length],
  };
  catalog.push(newType);
  return newType;
}

/** How many times `badgeTypeId` has been earned by this student — 0 if never. */
export function getBadgeCount(student, badgeTypeId) {
  return (student.notebookBadgeCounts || {})[badgeTypeId] || 0;
}

/**
 * Every badge type this student has earned at least once, in this
 * classroom's own catalog order — `{ ...type, count }`. Types with a
 * zero count are never included; a student's row must never display a
 * badge they have not earned (explicit product requirement).
 */
export function listEarnedBadges(classroom, student) {
  return listBadgeTypes(classroom)
    .map((type) => ({ ...type, count: getBadgeCount(student, type.id) }))
    .filter((type) => type.count > 0);
}

/**
 * Increments this student's own count for `badgeTypeId` by one and logs
 * a Participation History entry — mirrors badgeService.awardBadge()'s
 * own logEntry() call exactly, so both badge systems leave the same
 * shape of history trace. Unlike that function, this one is never a
 * no-op: the same badge type can be earned any number of times.
 */
export function awardNotebookBadge(classroom, student, badgeTypeId) {
  const type = getBadgeTypeById(classroom, badgeTypeId);
  if (!type) return 0;

  if (!student.notebookBadgeCounts) student.notebookBadgeCounts = {};
  student.notebookBadgeCounts[badgeTypeId] = (student.notebookBadgeCounts[badgeTypeId] || 0) + 1;
  logEntry(student, { kind: 'notebook-badge', label: type.name, delta: 0 });
  return student.notebookBadgeCounts[badgeTypeId];
}

/**
 * The symmetric inverse of awardNotebookBadge() — decrements this
 * student's own count for `badgeTypeId` by one, floored at 0 (never
 * negative, regardless of how many times this is called). Used by
 * services/notebookBadgeAwardService.js's revocation flows (currently
 * Readiness Champion only) once that service has already found and
 * marked the specific submission-scoped award entry revoked; this
 * function only ever touches the aggregate display count, never the
 * per-submission audit trail itself. Logs a Participation History
 * entry mirroring awardNotebookBadge()'s own shape, so a revocation is
 * just as visible in that history as the original award was.
 */
export function revokeNotebookBadge(classroom, student, badgeTypeId) {
  const type = getBadgeTypeById(classroom, badgeTypeId);
  if (!type) return 0;

  if (!student.notebookBadgeCounts) student.notebookBadgeCounts = {};
  const current = student.notebookBadgeCounts[badgeTypeId] || 0;
  student.notebookBadgeCounts[badgeTypeId] = Math.max(0, current - 1);
  logEntry(student, { kind: 'notebook-badge-revoked', label: type.name, delta: 0 });
  return student.notebookBadgeCounts[badgeTypeId];
}
