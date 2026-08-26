/**
 * services/timetableDisplayService.js
 *
 * Resolves the display strings a Timetable period card / Period Detail
 * panel needs — subject title, topic, concept titles — from the real
 * classroom data, never invented placeholder text. Pure, dependency-
 * free (no Firestore import), matching the same reasoning already
 * established in models/Lesson.js: this stays directly unit-testable.
 *
 * A period's SUBJECT is always resolvable from its Timetable slot
 * alone (see services/timetableService.js), independent of any Lesson
 * — the "preloaded subject tag" the product requires, before a lesson
 * plan is ever attached. TOPIC and concept titles only exist once a
 * Lesson (a lesson plan) is attached.
 */

import { getSubjects, getUnitById, findConcept } from './learningRecordService.js';
import { getCanonicalSubjectById } from './subjectIdentityService.js';

/**
 * This classroom's own LearningSubject record for a canonical
 * subjectId (e.g. "science") — distinct from LearningSubject.id, that
 * record's own generated id. A Timetable slot's subjectId is always
 * the canonical kind (see models/Timetable.js), so this is the join
 * every subject-title/color lookup here actually needs.
 */
export function findLearningSubjectByCanonicalId(classroom, canonicalSubjectId) {
  return getSubjects(classroom).find((subject) => subject.subjectId === canonicalSubjectId) || null;
}

/** The subject strip's own display title — the classroom's own Learning Record title if this subject has been set up there yet, otherwise the canonical registry's title, otherwise the raw id as a last resort (never blank). */
export function resolveSubjectTitle(classroom, canonicalSubjectId) {
  const learningSubject = findLearningSubjectByCanonicalId(classroom, canonicalSubjectId);
  if (learningSubject?.title) return learningSubject.title;
  const canonical = getCanonicalSubjectById(canonicalSubjectId);
  return canonical ? canonical.title : canonicalSubjectId;
}

/** The dominant "Topic" a period's card shows once a lesson plan is attached — the LearningUnit a Lesson's curriculumUnitId points to. Null before a lesson plan is attached, or if that unit can no longer be found. */
export function resolveLessonTopic(classroom, lesson) {
  if (!lesson?.curriculumUnitId) return null;
  return getUnitById(classroom, lesson.curriculumUnitId)?.title || null;
}

/** Every planned concept on a Lesson, resolved to {id, title} pairs in lesson.conceptIds' own order — what the Period Detail's Planned Concepts list renders. Empty array for no lesson / no concepts, never fabricated placeholders. */
export function resolveLessonConcepts(classroom, lesson) {
  if (!lesson) return [];
  return lesson.conceptIds.map((conceptId) => ({
    id: conceptId,
    title: findConcept(classroom, conceptId)?.concept?.title || conceptId,
  }));
}
