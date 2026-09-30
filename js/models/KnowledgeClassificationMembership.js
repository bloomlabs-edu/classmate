/**
 * models/KnowledgeClassificationMembership.js
 *
 * ClassMate Knowledge Model v1 — a CLASSIFICATION MEMBERSHIP: the join
 * record connecting one Concept to one Category within one
 * Classification. "Flood -> Natural -> within 'Based on causes of
 * occurrence'" is exactly one KnowledgeClassificationMembership
 * document: `{conceptId: <Flood>, classificationId: <Based on causes of
 * occurrence>, categoryId: <Natural>}`.
 *
 * This is deliberately its OWN top-level entity, never a field on
 * KnowledgeConcept and never a list embedded on KnowledgeClassification
 * — see models/KnowledgeConcept.js's own header comment for the full
 * reasoning ("a Category must never automatically become a Concept's
 * parent"). A membership record is a fact ABOUT a Concept, exactly like
 * a models/KnowledgeRelationship.js record is, not a structural
 * placement of it.
 *
 * A single Concept may hold any number of memberships — one per
 * Classification it's been placed in (Flood could independently belong
 * to a Category under "Based on causes of occurrence" AND a different
 * Category under "Based on origin" — two separate
 * KnowledgeClassificationMembership documents, neither aware of the
 * other).
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createKnowledgeClassificationMembership({
  id,
  conceptId,
  classificationId,
  categoryId,
  authorizingClassroomId,
  createdByUid,
  createdAt,
} = {}) {
  return {
    id: id || generateId(),
    conceptId,
    classificationId,
    categoryId,
    authorizingClassroomId,
    createdByUid,
    createdAt: createdAt || getCurrentIsoDate(),
  };
}
