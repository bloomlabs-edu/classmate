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
 * Management Subjects only had this one historical migration for a
 * while; `migrateUnitNumbers` below is the second one this file's own
 * comment anticipated ("worth revisiting... if or when a second
 * Subject-shape migration is ever needed"). Both stay plain,
 * independent, idempotent functions rather than becoming a versioned
 * pipeline — two migrations doesn't yet justify that machinery, the
 * same "smallest necessary" reasoning already applied to Curriculum
 * Index's own schema work when it genuinely did need one.
 */

import * as learningRecordService from './learningRecordService.js';
import { generateCustomSubjectId } from './subjectIdentityService.js';
import * as curriculumIndexRepository from './curriculumIndexRepository.js';

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

/**
 * Backfills `number` on every pre-existing LearningUnit that's missing
 * one but was genuinely linked from a Curriculum Index
 * (`linkedCurriculumUnitId` set) — for any Subject assigned before
 * curriculumLinkingService.js's buildUnitsFromCurriculumIndex() copied
 * `number` through at all. Looks the source Unit up by id in that
 * Subject's own linked Curriculum Index and copies its `number` over,
 * once, as a snapshot — never touching `title` or `partName`, which
 * may already have been customized in this classroom since assignment
 * (see models/LearningUnit.js's own header comment for why `number`,
 * `title`, and `partName` are all classroom snapshots, not live
 * references back to the Curriculum Index).
 *
 * A Unit with no `linkedCurriculumUnitId` at all (added directly by a
 * teacher, never linked from any curriculum) is correctly left alone
 * — it never had a source `number` to backfill from.
 *
 * Async, unlike migrateClassroomSubjects() above: this needs a real
 * Curriculum Index read (services/curriculumIndexRepository.js's
 * getIndex()), fetched once per distinct linked Curriculum Index
 * actually referenced, not once per Unit, so backfilling several
 * Units from the same curriculum only reads that document once.
 */
export async function migrateUnitNumbers(classroom) {
  let migratedCount = 0;
  const indexCache = new Map(); // curriculumIndexId -> fetched index (or null if not found), avoids re-fetching the same index for every Unit that needs it

  for (const subject of learningRecordService.getSubjects(classroom)) {
    if (!subject.linkedCurriculumIndexId) continue;

    const unitsNeedingBackfill = (subject.units || []).filter((unit) => unit.number == null && unit.linkedCurriculumUnitId);
    if (unitsNeedingBackfill.length === 0) continue;

    if (!indexCache.has(subject.linkedCurriculumIndexId)) {
      // eslint-disable-next-line no-await-in-loop
      const curriculumIndex = await curriculumIndexRepository.getIndex(subject.linkedCurriculumIndexId);
      indexCache.set(subject.linkedCurriculumIndexId, curriculumIndex);
    }
    const curriculumIndex = indexCache.get(subject.linkedCurriculumIndexId);
    if (!curriculumIndex) continue; // the linked Curriculum Index no longer exists — nothing to backfill from

    const sourceUnitById = new Map(curriculumIndex.units.map((unit) => [unit.id, unit]));
    unitsNeedingBackfill.forEach((unit) => {
      const sourceUnit = sourceUnitById.get(unit.linkedCurriculumUnitId);
      if (sourceUnit && sourceUnit.number != null) {
        unit.number = sourceUnit.number;
        migratedCount++;
      }
    });
  }

  return migratedCount;
}
