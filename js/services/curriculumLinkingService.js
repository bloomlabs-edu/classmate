/**
 * services/curriculumLinkingService.js
 *
 * The data flow this backs, verified and unchanged from the intended
 * design: Subject -> Assigned Curriculum -> Units -> Concepts. A
 * Subject does not own its own Units independent of a curriculum — it
 * has none until a curriculum is assigned, and every Unit it then has
 * is derived from that curriculum's own data, not hand-authored or
 * hardcoded on the Subject itself.
 *
 * Subject creation ("+ Add Subject" — see
 * ui/components/AddSubjectModal.js) and curriculum assignment
 * ("Assign Curriculum" — see
 * ui/components/AssignCurriculumModal.js) are two separate, explicit
 * teacher actions, not one combined step: a newly-created Subject has
 * `linkedCurriculumIndexId: null` and `units: []` until a teacher
 * deliberately assigns a curriculum to it, at which point (and only
 * then) this file materializes that curriculum's Units onto the
 * Subject. This is what "Science" showing up on the Learning
 * Management home screen the moment it's created, followed by "No
 * curriculum assigned" until the teacher explicitly does that
 * separately, actually means in code.
 *
 * Per the finalized architecture: Curriculum Management owns
 * Curriculum/Parts/Units; Concept Builder (not yet built) is the only
 * thing that will ever create Concepts. Assigning a curriculum
 * creates every Unit immediately — every one of them with
 * `concepts: []` — and creates nothing at the Concept level, on
 * purpose, not as a gap to fill in later.
 *
 * This is deliberately additive, not a replacement for
 * services/curriculumLibraryService.js's own existing
 * materializeUnitAndConcept() + classroom.curriculumAssignment path.
 * That mechanism links a classroom to an officially *published*
 * curriculum from the moderated Library, lazily creating Units/
 * Concepts as a teacher browses. This one assigns a teacher's own,
 * possibly-still-draft Curriculum Index to a Subject, eagerly, since a
 * Curriculum Index's full Units list already exists in one place at
 * assignment time — there's no browsing-driven reason to create them
 * lazily. The two mechanisms serve genuinely different sources and
 * neither replaces the other.
 */

import * as learningRecordService from './learningRecordService.js';
import { createLearningUnit } from '../models/LearningUnit.js';

/** Whether this classroom already has a Subject with this specific Curriculum Index assigned — what keeps the same curriculum from being assigned twice. */
export function isCurriculumIndexLinked(classroom, curriculumIndexId) {
  return learningRecordService.getSubjects(classroom).some((subject) => subject.linkedCurriculumIndexId === curriculumIndexId);
}

/**
 * "Assign Curriculum"'s own data: given a Subject's own title (e.g.
 * "Science"), which of the teacher's own Curriculum Indexes could back
 * it? Matched by exact subject name (trimmed, case-insensitive) —
 * deterministic, not a fuzzy guess — and excludes anything already
 * assigned to another Subject in this classroom, so an already-used
 * curriculum is never offered again.
 */
export function findAvailableCurriculumIndexesForSubject(classroom, allCurriculumIndexes, subjectName) {
  const normalizedTarget = subjectName.trim().toLowerCase();
  return allCurriculumIndexes.filter(
    (index) =>
      index.curriculum.subject.trim().toLowerCase() === normalizedTarget && !isCurriculumIndexLinked(classroom, index.id)
  );
}

function buildUnitsFromCurriculumIndex(curriculumIndex) {
  const partNameById = new Map(curriculumIndex.parts.map((part) => [part.id, part.name]));
  const hasMultipleParts = curriculumIndex.parts.length > 1;

  return curriculumIndex.units.map((unit) =>
    createLearningUnit({
      title: unit.title,
      partName: hasMultipleParts ? partNameById.get(unit.partId) : undefined,
      linkedCurriculumUnitId: unit.id,
    })
  );
}

/**
 * Assigns a Curriculum Index to an *already-existing* Subject —
 * mutates that Subject in place, materializing every Unit from the
 * curriculum's own data (carrying `partName` only when the curriculum
 * has more than one real Part — a single-Part ("General") curriculum
 * produces Units with no `partName` at all, so Learning Management
 * never shows Part grouping a teacher never asked for).
 *
 * Atomic by construction: every Unit is built in memory first; only
 * once that's fully succeeded are `linkedCurriculumIndexId` and
 * `units` set on the Subject together, in one step. If anything
 * throws while building Units, the Subject is left completely
 * unchanged — it never ends up with a curriculum link but no Units,
 * or Units but no link.
 *
 * Does not check isCurriculumIndexLinked() itself — callers (see
 * ui/components/AssignCurriculumModal.js) are expected to have
 * already filtered an already-assigned Curriculum Index out of what's
 * offered, so assignment is never attempted twice in the first place.
 */
export function assignCurriculumToSubject(classroom, subject, curriculumIndex) {
  const units = buildUnitsFromCurriculumIndex(curriculumIndex);
  subject.linkedCurriculumIndexId = curriculumIndex.id;
  subject.units = units;
  return subject;
}
