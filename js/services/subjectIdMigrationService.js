/**
 * services/subjectIdMigrationService.js
 *
 * A one-time repair for data created before `subjectId` existed —
 * explicitly scoped as historical migration, not part of the ongoing
 * architecture. See services/subjectIdentityService.js and
 * services/curriculumLinkingService.js for the actual, ongoing fix
 * (id-to-id comparison, decided once at creation time, never string
 * matching). Nothing in this file is ever consulted at match time by
 * anything else in the app — it runs once per record, backfills
 * `subjectId`, and is never read from again afterward.
 *
 * KNOWN_HISTORICAL_SPELLINGS below is deliberately not an ongoing
 * alias table: it exists only so this migration can make a one-time,
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
 * Idempotent by construction: only ever touches a Subject or
 * Curriculum Index whose `subjectId` is still null/undefined, so
 * running this repeatedly (once per classroom load, say) is always
 * safe and eventually a complete no-op.
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
 * from the two migration functions below.
 */
function resolveHistoricalSubjectId(existingTitle) {
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

/** Backfills subjectId on every pre-existing Curriculum Index that's missing one. Only ever adds subjectId — curriculum.subject (the display title) is never touched. */
export function migrateCurriculumIndex(curriculumIndex) {
  if (curriculumIndex.curriculum.subjectId) return false;
  curriculumIndex.curriculum.subjectId = resolveHistoricalSubjectId(curriculumIndex.curriculum.subject);
  return true;
}
