/**
 * models/KnowledgeConcept.js
 *
 * ClassMate Knowledge Model v1 — a CONCEPT: a single unit of shared,
 * textbook-level knowledge (e.g. "Flood", "Hazard", "Heavy rainfall",
 * "Earthquake") that can be learned, explained, assessed, or connected
 * to other Concepts. Global and reusable — never owned by one
 * classroom, grade, subject, or curriculum edition.
 *
 * ---------------------------------------------------------------------
 * NOT the same thing as models/LearningConcept.js
 * ---------------------------------------------------------------------
 *
 * models/LearningConcept.js is a classroom's own OPERATIONAL teaching
 * record — an embedded leaf of one classroom's
 * `learningRecord.subjects[].units[].concepts[]` tree, carrying
 * classroom-specific state (taught/not-taught status, that classroom's
 * own resource links, per-student understanding). It has no stable
 * cross-classroom identity (its `id` is minted fresh per classroom) and
 * no relationship/classification machinery.
 *
 * A KnowledgeConcept is the opposite on every count: it is the SAME
 * document regardless of which classroom, teacher, or curriculum
 * edition is discussing it, has its own stable, globally-unique id, and
 * exists specifically to carry RELATIONSHIP
 * (models/KnowledgeRelationship.js) and CLASSIFICATION MEMBERSHIP
 * (models/KnowledgeClassificationMembership.js) data that a classroom's
 * own LearningConcept was never built to hold.
 *
 * v1 deliberately does NOT migrate or link to any classroom's existing
 * LearningConcept records — LearningConcept ids are classroom-local and
 * frequently duplicated/differently-spelled across classrooms, and
 * reconciling that is a separate, later migration decision, not a v1
 * concern.
 *
 * ---------------------------------------------------------------------
 * No parentId, categoryId, classificationId, or any single-parent field
 * ---------------------------------------------------------------------
 *
 * This is the one rule this whole Knowledge Model is built around: a
 * Concept never stores a pointer to "its" parent/category/
 * classification, because it doesn't have exactly one. "Flood" is
 * CAUSED_BY heavy rainfall, IS_A Hazard, and separately belongs to the
 * "Natural" category under the "Based on causes of occurrence"
 * Classification — three independent facts, each one its own record
 * (KnowledgeRelationship x2, KnowledgeClassificationMembership x1),
 * none of them a structural parent of this Concept. A Category must
 * NEVER automatically become a Concept, and a Concept must never gain a
 * parent field, no matter how convenient a future "just add
 * categoryId" shortcut might look.
 *
 * ---------------------------------------------------------------------
 * `sourceCurriculumUnitId` — optional PROVENANCE only, never ownership
 * ---------------------------------------------------------------------
 *
 * Records "this Concept was first authored while covering this
 * classroom-local Unit" (see models/LearningUnit.js), purely for
 * discoverability/traceability — the same non-binding-reference
 * precedent models/LearningConcept.js's own `learningHubConcept` field
 * already establishes for "related to, but does not define the scope
 * of." A Concept authored while covering a Grade 8 Geography chapter is
 * not a "Grade 8 Geography Concept" — it is a global Concept that
 * happens to record where it was first written down. Nullable; a
 * Concept authored independent of any specific chapter has none.
 *
 * ---------------------------------------------------------------------
 * `authorizingClassroomId` — a write-time AUTHORIZATION credential only
 * ---------------------------------------------------------------------
 *
 * See firestore.rules' own header comment on the `knowledgeConcepts`
 * match block for the full reasoning. In short: PROGRAM_MANAGER
 * (config/memberRoles.js) is a per-classroom membership role with no
 * cross-classroom "this uid is a PM anywhere" identity yet, so every
 * write names ONE classroom where the author actually holds that role,
 * purely so the security rule has a concrete document to check. This
 * field has NO bearing on this Concept's scope, ownership, or
 * discoverability — it is not `sourceCurriculumUnitId`, and reusing it
 * as if it were a scope field would reintroduce exactly the kind of
 * conflation this model exists to avoid. It exists ONLY because current
 * Firestore Security Rules cannot verify "is this uid a Program Manager
 * on any classroom" without a known classroom to check against.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createKnowledgeConcept({
  id,
  title = '',
  description = null,
  sourceCurriculumUnitId = null,
  authorizingClassroomId,
  createdByUid,
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    title,
    description,
    sourceCurriculumUnitId,
    authorizingClassroomId,
    createdByUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}
