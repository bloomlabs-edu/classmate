/**
 * models/KnowledgeRelationship.js
 *
 * ClassMate Knowledge Model v1 — a RELATIONSHIP: one typed, directional
 * semantic connection between exactly two KnowledgeConcepts (see
 * models/KnowledgeConcept.js). "Heavy rainfall CAUSES Flood" is one
 * KnowledgeRelationship document: `{fromConceptId: <Heavy rainfall>,
 * toConceptId: <Flood>, type: 'CAUSES'}`.
 *
 * ---------------------------------------------------------------------
 * Reverse relationships are DERIVED, never independently stored
 * ---------------------------------------------------------------------
 *
 * Only the canonical (forward) direction is ever persisted — there is
 * no separate "Flood IS_CAUSED_BY Heavy rainfall" document, and nothing
 * in this app should ever create one. `getReverseRelationshipLabel()`
 * below is how a UI displays the SAME stored fact from the other
 * Concept's point of view ("Flood" page shows "is caused by: Heavy
 * rainfall", derived from the exact same document "Heavy rainfall"'s
 * own page reads as "causes: Flood"). Storing both directions would let
 * them drift out of sync (delete one, forget the other) — deriving the
 * reverse keeps exactly one row of truth per fact.
 *
 * ---------------------------------------------------------------------
 * A CLOSED v1 enum, not an open vocabulary
 * ---------------------------------------------------------------------
 *
 * Unlike models/Spark.js's own deliberately open `tags[]` ("a filter
 * vocabulary, not an exhaustive classification"), a relationship TYPE
 * must stay closed and enumerable — a free-text relationship type would
 * make the graph unqueryable and inconsistent (no reliable way to ask
 * "show me everything this Concept CAUSES" if "causes"/"Causes"/"leads
 * to" were all valid spellings of the same fact). Exactly the 9 types
 * the product brief specifies; no admin/dynamic type creation in v1.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export const RELATIONSHIP_TYPES = Object.freeze({
  IS_A: 'IS_A',
  PART_OF: 'PART_OF',
  CAUSES: 'CAUSES',
  HAS_ASPECT: 'HAS_ASPECT',
  HAS_PROPERTY: 'HAS_PROPERTY',
  EXAMPLE_OF: 'EXAMPLE_OF',
  RELATED_TO: 'RELATED_TO',
  CONTRASTS_WITH: 'CONTRASTS_WITH',
  PREREQUISITE_FOR: 'PREREQUISITE_FOR',
});

/**
 * `{ forward, reverse }` display phrasing for each type — e.g. CAUSES
 * reads "causes" from the `fromConceptId` Concept's own page, and its
 * stored-nowhere-else reverse reads "is caused by" from the
 * `toConceptId` Concept's page. RELATED_TO/CONTRASTS_WITH are
 * symmetric — their reverse phrasing is identical to their forward
 * phrasing, since "A is related to B" and "B is related to A" are the
 * same claim read from either side.
 */
const RELATIONSHIP_TYPE_LABELS = Object.freeze({
  [RELATIONSHIP_TYPES.IS_A]: { forward: 'is a', reverse: 'includes' },
  [RELATIONSHIP_TYPES.PART_OF]: { forward: 'is part of', reverse: 'has part' },
  [RELATIONSHIP_TYPES.CAUSES]: { forward: 'causes', reverse: 'is caused by' },
  [RELATIONSHIP_TYPES.HAS_ASPECT]: { forward: 'has aspect', reverse: 'is an aspect of' },
  [RELATIONSHIP_TYPES.HAS_PROPERTY]: { forward: 'has property', reverse: 'is a property of' },
  [RELATIONSHIP_TYPES.EXAMPLE_OF]: { forward: 'is an example of', reverse: 'has example' },
  [RELATIONSHIP_TYPES.RELATED_TO]: { forward: 'is related to', reverse: 'is related to' },
  [RELATIONSHIP_TYPES.CONTRASTS_WITH]: { forward: 'contrasts with', reverse: 'contrasts with' },
  [RELATIONSHIP_TYPES.PREREQUISITE_FOR]: { forward: 'is a prerequisite for', reverse: 'requires' },
});

/** The forward-direction display phrase for a relationship type (from `fromConceptId`'s own point of view) — falls back to the raw type string for an unrecognized value, never a blank label. */
export function getRelationshipForwardLabel(type) {
  return RELATIONSHIP_TYPE_LABELS[type]?.forward || type;
}

/** The DERIVED reverse-direction display phrase (from `toConceptId`'s own point of view) — see this file's own header comment on why this is computed here, never persisted as its own document. */
export function getReverseRelationshipLabel(type) {
  return RELATIONSHIP_TYPE_LABELS[type]?.reverse || type;
}

export function createKnowledgeRelationship({
  id,
  fromConceptId,
  toConceptId,
  type,
  authorizingClassroomId,
  createdByUid,
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    fromConceptId,
    toConceptId,
    type,
    authorizingClassroomId,
    createdByUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}
