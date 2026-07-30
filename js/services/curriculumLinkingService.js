/**
 * services/curriculumLinkingService.js
 *
 * Backs "+ Add Subject" — replaces the old hardcoded Subject Picker
 * (config/commonSubjectsConfig.js's fixed list, still shown as the
 * *first* step of this flow, "Choose Subject") as the way a new
 * Subject's actual content enters a classroom's Learning Record.
 * Two teacher-facing steps, entirely hidden from each other's
 * plumbing: "Choose Subject" picks a plain subject name (reusing the
 * existing ui/components/SubjectPicker.js unchanged); "Choose
 * Curriculum" (this file) finds which of the teacher's own Curriculum
 * Indexes (services/curriculumIndexRepository.js) match that name and
 * links whichever one is chosen, creating a real, populated
 * LearningSubject from it. A teacher never sees or names either step
 * "linking" or "Curriculum Index" — see
 * ui/views/LearningManagementView.js's own header comment for how
 * that separation is kept out of the UI entirely.
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
import { createLearningSubject } from '../models/LearningSubject.js';
import { createLearningUnit } from '../models/LearningUnit.js';

/** Whether this classroom already has a Subject linked to this specific Curriculum Index — what keeps the same curriculum from being linked twice. */
export function isCurriculumIndexLinked(classroom, curriculumIndexId) {
  return learningRecordService.getSubjects(classroom).some((subject) => subject.linkedCurriculumIndexId === curriculumIndexId);
}

/**
 * "Choose Curriculum"'s own data: given the subject name a teacher
 * just picked in "Choose Subject" (a plain string — "Science," or
 * whatever they typed into "Custom Subject"), which of their own
 * Curriculum Indexes could back it? Matched by exact subject name
 * (trimmed, case-insensitive) — deterministic, not a fuzzy guess —
 * and excludes anything already linked to this classroom, so an
 * already-added curriculum is never offered again.
 */
export function findAvailableCurriculumIndexesForSubject(classroom, allCurriculumIndexes, subjectName) {
  const normalizedTarget = subjectName.trim().toLowerCase();
  return allCurriculumIndexes.filter(
    (index) =>
      index.curriculum.subject.trim().toLowerCase() === normalizedTarget && !isCurriculumIndexLinked(classroom, index.id)
  );
}

/**
 * Creates a LearningSubject from a Curriculum Index. `subjectTitle`
 * defaults to the curriculum's own `subject` field ("Science") but
 * can be overridden — the two-step "Choose Subject" (a plain subject
 * name) then "Choose Curriculum" (which curriculum backs it) flow
 * establishes the subject's name in its own, earlier step, and that
 * teacher-chosen name is what should title the Subject, not
 * necessarily whatever the curriculum's own metadata happens to say.
 *
 * Every Unit is created in the Curriculum Index's own order,
 * carrying `partName` only when the Curriculum Index has more than
 * one real Part — a single-Part ("General") curriculum produces Units
 * with no `partName` at all, so Learning Management never shows Part
 * grouping a teacher never asked for, the same rule already used on
 * Curriculum Index's own Review Units screen.
 *
 * Atomic by construction: the whole Subject, with every Unit already
 * attached, is built in memory first (using the model factories
 * directly, not services/learningRecordTeacherService.js's own
 * createSubject()/createUnit(), which each push into the classroom's
 * real collection immediately on call). Only once every Unit has been
 * built successfully does this push the finished Subject into
 * `classroom.learningRecord.subjects`, in one step. If anything throws
 * while building Units, nothing has been added to the real collection
 * yet — a partially-built Subject can never end up visible on the
 * Learning Management home screen.
 *
 * Does not check isCurriculumIndexLinked() itself — callers (see
 * ui/views/LearningManagementView.js) are expected to have already
 * filtered an already-linked Curriculum Index out of what's offered,
 * so linking is never attempted twice in the first place.
 */
export function linkCurriculumIndex(classroom, curriculumIndex, subjectTitle = curriculumIndex.curriculum.subject) {
  const partNameById = new Map(curriculumIndex.parts.map((part) => [part.id, part.name]));
  const hasMultipleParts = curriculumIndex.parts.length > 1;

  const units = curriculumIndex.units.map((unit) =>
    createLearningUnit({
      title: unit.title,
      partName: hasMultipleParts ? partNameById.get(unit.partId) : undefined,
      linkedCurriculumUnitId: unit.id,
    })
  );

  const subject = createLearningSubject({
    title: subjectTitle,
    linkedCurriculumIndexId: curriculumIndex.id,
    units,
  });

  const learningRecord = classroom.learningRecord || (classroom.learningRecord = { subjects: [] });
  if (!learningRecord.subjects) learningRecord.subjects = [];
  learningRecord.subjects.push(subject);

  return subject;
}
