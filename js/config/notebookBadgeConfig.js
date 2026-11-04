/**
 * config/notebookBadgeConfig.js
 *
 * The starting catalog of Notebook Tracker's own compact achievement
 * badges (Student Row Redesign) — stored per-classroom
 * (classroom.settings.notebookBadgeTypes, mirroring
 * config/badgeConfig.js's own DEFAULT_BADGE_CATALOG/badgeCatalog shape
 * exactly), so a teacher's "+ Add Badge Type" additions only ever
 * extend their own classroom's list via services/notebookBadgeService.js.
 *
 * Each entry's `id` doubles as config/badgeDefinitions.js's own
 * `recognitionType` for the three seed types below — see that file's
 * NOTEBOOK_HABITS family for the icon/theme this id resolves to.
 * Teacher-added types carry their own generated id instead and supply
 * `icon`/`theme` directly (see notebookBadgeService.addBadgeType()).
 */

export const DEFAULT_NOTEBOOK_BADGE_TYPES = Object.freeze([
  { id: 'organization', name: 'Organization', icon: 'folder', theme: 'green' },
  { id: 'punctuation-champion', name: 'Punctuation Champion', icon: 'quote', theme: 'blue' },
  { id: 'readiness-champion', name: 'Readiness Champion', icon: 'calendar-check', theme: 'purple' },
]);
