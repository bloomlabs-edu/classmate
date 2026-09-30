/**
 * models/KnowledgeClassification.js
 *
 * ClassMate Knowledge Model v1 — a CLASSIFICATION: a named lens used to
 * group Concepts (e.g. "Based on causes of occurrence", "Based on
 * origin"). GLOBAL and reusable across every subject/grade/curriculum —
 * "Based on causes of occurrence" is one Classification, not something
 * owned by Grade 8 Geography, so the same lens can be reused anywhere
 * it's relevant without re-authoring it per subject.
 *
 * A Classification owns its own CATEGORIES (the options within it —
 * e.g. Natural/Human-made/Socio-natural) as a plain, ordered array
 * field on this same document — mirroring
 * services/curriculumIndexRepository.js's own `CurriculumIndex.parts[]`
 * precedent (a small, stable, ordered set of child records that don't
 * need their own independent permissions/timestamps). A Category has no
 * meaning or lookup path independent of its own Classification, the
 * same "child object owned by exactly one parent document" convention
 * models/ConceptResourceLink.js already establishes.
 *
 * A Classification does NOT own any Concepts. Which Concepts belong to
 * which Category, under which Classification, is recorded entirely in
 * the separate models/KnowledgeClassificationMembership.js join
 * records — never as a list embedded here. This keeps "define the lens"
 * and "assign a Concept to it" as two independent actions with two
 * independent authorship trails.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** One Category — an option within its owning Classification's own `categories[]` array. Order is array position, the same convention every other ordered child array in this app already uses (see models/Task.js's own subtasks, models/LearningUnit.js's own concepts) — no separate index field to keep in sync. */
export function createKnowledgeCategory({ id, name = '' } = {}) {
  return {
    id: id || generateId(),
    name,
  };
}

export function createKnowledgeClassification({
  id,
  name = '',
  description = null,
  categories = [],
  authorizingClassroomId,
  createdByUid,
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    name,
    description,
    categories,
    authorizingClassroomId,
    createdByUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}

/** One Category by its own id within a Classification's `categories[]`, or null — mirrors models/Task.js's own findTaskSubtask(). */
export function findKnowledgeCategory(classification, categoryId) {
  return (classification.categories || []).find((category) => category.id === categoryId) || null;
}

/** The index of one Category by its own id, or -1 — the one place a future mutator (add/rename/remove Category) should look this up, mirroring models/LessonPlan.js's own getLessonPlanActivityIndex()/models/Task.js's own getTaskSubtaskIndex(). */
export function getKnowledgeCategoryIndex(classification, categoryId) {
  return (classification.categories || []).findIndex((category) => category.id === categoryId);
}
