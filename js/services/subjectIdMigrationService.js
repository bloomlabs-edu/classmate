/**
 * services/subjectIdMigrationService.js
 *
 * A one-time repair for data created before `subjectId` existed —
 * explicitly scoped as historical migration, not part of the ongoing
 * architecture. See services/subjectIdentityService.js and
 * services/curriculumLinkingService.js for the actual, ongoing fix
 * (id-to-id comparison, decided once at creation time, never string
 * matching).
 *
 * KNOWN_HISTORICAL_SPELLINGS below is deliberately not an ongoing
 * alias table: it exists only so a migration can make a one-time,
 * historical judgment call about data that already exists — "this
 * Subject titled 'Maths' and this Curriculum titled 'Mathematics'
 * were almost certainly meant to be the same subject" — a judgment
 * that's reasonable to make exactly once, while repairing old data,
 * and never repeated as a runtime service other code depends on. Any
 * new subject created from this point forward gets its `subjectId`
 * from services/subjectIdentityService.js instead — a canonical
 * suggestion's own fixed id, or a fresh id generated from exactly what
 * was typed. This mapping is not consulted for anything new.
 *
 * `resolveHistoricalSubjectId` is exported specifically so
 * services/curriculumIndexMigrationService.js's own versioned
 * migration pipeline can reuse the exact same historical-spelling
 * judgment call for Curriculum Index's subjectId backfill step,
 * rather than that logic existing in two places that could drift
 * apart.
 *
 * `migrateClassroomSubjects` remains a plain, one-shot function (not
 * yet folded into a versioned schemaVersion pipeline) — Learning
 * Management Subjects only have this one historical migration to
 * date, so introducing a full pipeline here would be building
 * machinery for a second step that doesn't exist yet. Worth revisiting
 * the same way Curriculum Index just was, if or when a second
 * Subject-shape migration is ever needed.
 */

import * as learningRecordService from './learningRecordService.js';
import { generateCustomSubjectId } from './subjectIdentityService.js';

const KNOWN_HISTORICAL_SPELLINGS = {
  science: 'science',
  maths: 'mathematics',
  mathematics: 'mathematics',
  english: 'english',
  'social science': 'social_science',
  'social studies': 'social_science',
  sst: 'social_science',
  hindi: 'hindi',
  'computer science': 'computer_science',
  computers: 'computer_science',
  'environmental studies': 'environmental_studies',
  evs: 'environmental_studies',
  art: 'art',
  'art and craft': 'art',
};

/**
 * The historical-judgment-call step, run once per pre-existing title —
 * never called anywhere in the app's ongoing matching logic, only
 * from migration code (this file's own migrateClassroomSubjects()
 * below, and services/curriculumIndexMigrationService.js's own
 * subjectId migration step).
 */
export function resolveHistoricalSubjectId(existingTitle) {
  const normalized = existingTitle.trim().toLowerCase();
  return KNOWN_HISTORICAL_SPELLINGS[normalized] || generateCustomSubjectId(existingTitle);
}

/** Backfills subjectId on every pre-existing Learning Management Subject in this classroom that's missing one. Titles are never changed — only subjectId is added. */
export function migrateClassroomSubjects(classroom) {
  let migratedCount = 0;
  learningRecordService.getSubjects(classroom).forEach((subject) => {
    if (subject.subjectId) return;
    subject.subjectId = resolveHistoricalSubjectId(subject.title);
    migratedCount++;
  });
  return migratedCount;
}
