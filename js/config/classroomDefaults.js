/**
 * config/classroomDefaults.js
 *
 * Default classroom-level settings and the Setup Wizard's progress model.
 *
 * `buildDefaultSettings()` returns a fresh object on every call (never a
 * shared reference) — each classroom gets its own independent settings,
 * including its own editable bucket-scoring values (never hardcoded
 * elsewhere in the app — see services/bucketService.js).
 *
 * PROGRESS_STEP_KEYS lists the Setup Wizard steps that count toward the
 * progress percentage. "Invite Teachers" is included here — the
 * co-teacher join-code mechanism it depends on already exists and
 * works (see services/workspaceService.js's joinClassroomByCode()),
 * so there's no longer a reason to exclude it as not-yet-actionable.
 */

import { DEFAULT_BADGE_CATALOG } from './badgeConfig.js';

export const PROGRESS_STEP_KEYS = Object.freeze([
  'classroomDetails',
  'importStudents',
  'assignBuckets',
  'customizeGroups',
  'configureScoring',
  'inviteTeachers',
]);

export function buildDefaultSettings() {
  return {
    bucketScoring: { green: 1, yellow: 2, red: 3 },
    scoring: {
      defaultPointValue: 1,
      allowNegativePoints: false,
    },
    // A fresh copy per classroom — never the shared DEFAULT_BADGE_CATALOG
    // array itself — so one classroom adding/removing a badge type never
    // affects another (see services/badgeService.js).
    badgeCatalog: [...DEFAULT_BADGE_CATALOG],
    setupProgress: {
      classroomDetails: true, // captured at creation, so this starts done
      importStudents: false,
      assignBuckets: false,
      customizeGroups: false,
      configureScoring: false,
    },
  };
}
