/**
 * services/curriculumLinkingService.js
 *
 * "Link Curriculum" — replaces the old hardcoded Subject Picker
 * (config/commonSubjectsConfig.js's fixed list) as the way a new
 * Subject enters a classroom's Learning Record. A teacher no longer
 * picks a generic subject name and builds its Units/Concepts by hand;
 * they choose one of their own Curriculum Indexes
 * (services/curriculumIndexRepository.js) and this creates a real,
 * populated LearningSubject from it.
 *
 * Per the finalized architecture: Curriculum Management owns
 * Curriculum/Parts/Units; Concept Builder (not yet built) is the only
 * thing that will ever create Concepts. Linking creates the
 * LearningSubject and its LearningUnits immediately — every one of
 * them with `concepts: []` — and creates nothing at the Concept
 * level, on purpose, not as a gap to fill in later.
 *
 * This is deliberately additive, not a replacement for
 * services/curriculumLibraryService.js's own existing
 * materializeUnitAndConcept() + classroom.curriculumAssignment path.
 * That mechanism links a classroom to an officially *published*
 * curriculum from the moderated Library, lazily creating Units/
 * Concepts as a teacher browses. This one links a teacher's own,
 * possibly-still-draft Curriculum Index, eagerly, since a Curriculum
 * Index's full Units list already exists in one place at link time —
 * there's no browsing-driven reason to create them lazily. The two
 * mechanisms serve genuinely different sources and neither replaces
 * the other.
 */

import * as learningRecordService from './learningRecordService.js';
import * as learningRecordTeacherService from './learningRecordTeacherService.js';

/** Whether this classroom already has a Subject linked to this specific Curriculum Index — what keeps the same curriculum from being linked twice. */
export function isCurriculumIndexLinked(classroom, curriculumIndexId) {
  return learningRecordService.getSubjects(classroom).some((subject) => subject.linkedCurriculumIndexId === curriculumIndexId);
}

/**
 * Creates a LearningSubject from a Curriculum Index, titled from the
 * curriculum's own `subject` field (e.g. "Science") rather than its
 * full name ("Samacheer Kalvi") — a Learning Management Subject reads
 * the same way the old hardcoded picker's buttons did.
 *
 * Every Unit is created in the Curriculum Index's own order,
 * carrying `partName` only when the Curriculum Index has more than
 * one real Part — a single-Part ("General") curriculum produces Units
 * with no `partName` at all, so Learning Management never shows Part
 * grouping a teacher never asked for, the same rule already used on
 * Curriculum Index's own Review Units screen.
 *
 * Does not check isCurriculumIndexLinked() itself — callers (see
 * ui/views/LearningManagementView.js) are expected to have already
 * filtered an already-linked Curriculum Index out of what's offered,
 * so linking is never attempted twice in the first place.
 */
export function linkCurriculumIndex(classroom, curriculumIndex) {
  const subject = learningRecordTeacherService.createSubject(classroom, {
    title: curriculumIndex.curriculum.subject,
    linkedCurriculumIndexId: curriculumIndex.id,
  });

  const partNameById = new Map(curriculumIndex.parts.map((part) => [part.id, part.name]));
  const hasMultipleParts = curriculumIndex.parts.length > 1;

  curriculumIndex.units.forEach((unit) => {
    learningRecordTeacherService.createUnit(classroom, subject.id, {
      title: unit.title,
      partName: hasMultipleParts ? partNameById.get(unit.partId) : undefined,
      linkedCurriculumUnitId: unit.id,
    });
  });

  return subject;
}
