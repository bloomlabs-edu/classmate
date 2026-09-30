import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findKnowledgeConceptsForUnit,
  findKnowledgeConceptForTextbookItem,
  findDirectRelationshipsForConcept,
  buildRelationshipDisplayLines,
  buildTextbookItemEnrichment,
  buildUnitKnowledgeEnrichment,
} from '../../js/ui/views/KnowledgeCurriculumLinkDisplay.js';
import { RELATIONSHIP_TYPES } from '../../js/models/KnowledgeRelationship.js';

const UNIT_ID = 'floods'; // slugify('Floods') — matching the real, published unit.id shape
const OTHER_UNIT_ID = 'earthquakes';

const CONCEPTS = [
  { id: 'concept-flood', title: 'Flood', sourceCurriculumUnitId: UNIT_ID },
  { id: 'concept-heavy-rainfall', title: 'Heavy rainfall', sourceCurriculumUnitId: UNIT_ID },
  { id: 'concept-hazard', title: 'Hazard', sourceCurriculumUnitId: null },
  { id: 'concept-tsunami', title: 'Tsunami', sourceCurriculumUnitId: OTHER_UNIT_ID },
];

const RELATIONSHIPS = [
  { id: 'rel-1', fromConceptId: 'concept-heavy-rainfall', toConceptId: 'concept-flood', type: RELATIONSHIP_TYPES.CAUSES },
  { id: 'rel-2', fromConceptId: 'concept-flood', toConceptId: 'concept-hazard', type: RELATIONSHIP_TYPES.IS_A },
  { id: 'rel-3', fromConceptId: 'concept-tsunami', toConceptId: 'concept-hazard', type: RELATIONSHIP_TYPES.IS_A }, // unrelated to Flood
];

// ---------------------------------------------------------------------
// 1-4: matching KnowledgeConcepts to a curriculum unit / textbook item
// ---------------------------------------------------------------------

test('1. No KnowledgeConcepts at all -> no enrichment', () => {
  assert.equal(findKnowledgeConceptForTextbookItem([], { unitId: UNIT_ID, itemTitle: 'Flood' }), null);
  assert.equal(buildTextbookItemEnrichment([], [], { unitId: UNIT_ID, itemTitle: 'Flood' }), null);
});

test('2. A KnowledgeConcept with matching sourceCurriculumUnitId AND exact title is matched', () => {
  const match = findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: UNIT_ID, itemTitle: 'Flood' });
  assert.equal(match.id, 'concept-flood');
});

test('3. A KnowledgeConcept from another unit is NOT matched, even with the same title', () => {
  const concepts = [{ id: 'concept-flood-other-unit', title: 'Flood', sourceCurriculumUnitId: OTHER_UNIT_ID }];
  assert.equal(findKnowledgeConceptForTextbookItem(concepts, { unitId: UNIT_ID, itemTitle: 'Flood' }), null);
});

test('4. Exact matching only — no fuzzy/semantic matching', () => {
  // Case/whitespace-insensitive is still "exact" (same convention as K2.1/K2.4).
  assert.equal(findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: UNIT_ID, itemTitle: '  flood  ' }).id, 'concept-flood');
  // A near-synonym or partial title is never a match.
  assert.equal(findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: UNIT_ID, itemTitle: 'Flooding' }), null);
  assert.equal(findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: UNIT_ID, itemTitle: 'Floo' }), null);
});

// ---------------------------------------------------------------------
// 5: multiple KnowledgeConcepts associated with the same Unit
// ---------------------------------------------------------------------

test('5. Multiple KnowledgeConcepts from the same Unit each resolve to their own textbook item independently', () => {
  const flood = findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: UNIT_ID, itemTitle: 'Flood' });
  const heavyRainfall = findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: UNIT_ID, itemTitle: 'Heavy rainfall' });
  assert.equal(flood.id, 'concept-flood');
  assert.equal(heavyRainfall.id, 'concept-heavy-rainfall');
  assert.deepEqual(
    findKnowledgeConceptsForUnit(CONCEPTS, UNIT_ID).map((c) => c.id).sort(),
    ['concept-flood', 'concept-heavy-rainfall']
  );
});

// ---------------------------------------------------------------------
// 6, 9, 10, 11: direct relationship resolution, never recursive
// ---------------------------------------------------------------------

test('6. Direct relationships for a matched Concept are resolved (both directions)', () => {
  const rels = findDirectRelationshipsForConcept(RELATIONSHIPS, 'concept-flood');
  assert.deepEqual(rels.map((r) => r.id).sort(), ['rel-1', 'rel-2']);
});

test('9. Multiple relationships for one Concept all appear', () => {
  const lines = buildRelationshipDisplayLines(RELATIONSHIPS, 'concept-flood', CONCEPTS);
  assert.equal(lines.length, 2);
});

test('10. Relationships not touching the matched Concept are excluded', () => {
  const lines = buildRelationshipDisplayLines(RELATIONSHIPS, 'concept-flood', CONCEPTS);
  assert.ok(!lines.some((l) => l.relationshipId === 'rel-3'), 'rel-3 (Tsunami IS_A Hazard) must not appear for Flood');
});

test('11. No recursive traversal occurs — a relationship of the OTHER concept (Hazard) is never pulled in for Flood', () => {
  // Hazard has no relationships of its own in this fixture, but even if it
  // did, buildRelationshipDisplayLines for 'concept-flood' must never look
  // beyond concept-flood's own direct edges.
  const relationshipsWithHazardEdge = [...RELATIONSHIPS, { id: 'rel-4', fromConceptId: 'concept-hazard', toConceptId: 'concept-tsunami', type: RELATIONSHIP_TYPES.RELATED_TO }];
  const lines = buildRelationshipDisplayLines(relationshipsWithHazardEdge, 'concept-flood', CONCEPTS);
  assert.ok(!lines.some((l) => l.relationshipId === 'rel-4'), 'a relationship two hops away must never appear for the matched Concept');
  assert.equal(lines.length, 2);
});

// ---------------------------------------------------------------------
// 7, 8: forward / reverse relationship display wording
// ---------------------------------------------------------------------

test('7. Forward relationship display — "Flood IS_A Hazard" reads as "is a Hazard" from Flood\'s own side', () => {
  const lines = buildRelationshipDisplayLines(RELATIONSHIPS, 'concept-flood', CONCEPTS);
  const forwardLine = lines.find((l) => l.relationshipId === 'rel-2');
  assert.equal(forwardLine.text, 'is a Hazard');
});

test('8. Reverse relationship display — "Heavy rainfall CAUSES Flood" reads as "is caused by Heavy rainfall" from Flood\'s own side', () => {
  const lines = buildRelationshipDisplayLines(RELATIONSHIPS, 'concept-flood', CONCEPTS);
  const reverseLine = lines.find((l) => l.relationshipId === 'rel-1');
  assert.equal(reverseLine.text, 'is caused by Heavy rainfall');
});

test('Matches the worked example exactly: Flood -> "is a Hazard" and "is caused by Heavy rainfall"', () => {
  const enrichment = buildTextbookItemEnrichment(CONCEPTS, RELATIONSHIPS, { unitId: UNIT_ID, itemTitle: 'Flood' });
  assert.equal(enrichment.conceptTitle, 'Flood');
  assert.deepEqual(
    enrichment.relationshipLines.map((l) => l.text).sort(),
    ['is a Hazard', 'is caused by Heavy rainfall']
  );
});

// ---------------------------------------------------------------------
// 12: empty relationship set
// ---------------------------------------------------------------------

test('12. A matched Concept with zero relationships produces an empty relationshipLines array, not an error', () => {
  const enrichment = buildTextbookItemEnrichment(CONCEPTS, [], { unitId: UNIT_ID, itemTitle: 'Flood' });
  assert.deepEqual(enrichment.relationshipLines, []);
});

// ---------------------------------------------------------------------
// 13: existing curriculum item data is not mutated
// ---------------------------------------------------------------------

test('13. Existing curriculum Unit data is never mutated — a frozen unit can be passed safely', () => {
  const unit = Object.freeze({ id: UNIT_ID, title: 'Floods', concepts: Object.freeze(['Flood', 'Heavy rainfall']) });
  const enrichment = buildUnitKnowledgeEnrichment(unit, CONCEPTS, RELATIONSHIPS);
  assert.deepEqual(Object.keys(enrichment).sort(), ['Flood', 'Heavy rainfall']);
  // Frozen input — if buildUnitKnowledgeEnrichment ever tried to write to
  // `unit` or `unit.concepts`, this call would throw in strict mode. It doesn't.
});

// ---------------------------------------------------------------------
// 14: title-slug/provenance limitation — exact ID matching only
// ---------------------------------------------------------------------

test('14. The join is exact-id-based (sourceCurriculumUnitId === unit.id) — a different unit id never matches, even for the exact same title', () => {
  // Simulates the accepted title-slug limitation: if a unit were ever
  // republished under a different id (e.g. "floods" -> "floods-2027"
  // after a retitle), a Concept authored against the OLD id no longer
  // matches the NEW unit, by design — no fuzzy/near-id matching exists.
  const rePublishedUnitId = 'floods-2027';
  assert.equal(findKnowledgeConceptForTextbookItem(CONCEPTS, { unitId: rePublishedUnitId, itemTitle: 'Flood' }), null);
});

// ---------------------------------------------------------------------
// buildUnitKnowledgeEnrichment — the top-level orchestration
// ---------------------------------------------------------------------

test('buildUnitKnowledgeEnrichment: only reviewed items appear in the returned map; unreviewed items are simply absent', () => {
  const unit = { id: UNIT_ID, title: 'Floods', concepts: ['Flood', 'Heavy rainfall', 'Cloud burst'] };
  const enrichment = buildUnitKnowledgeEnrichment(unit, CONCEPTS, RELATIONSHIPS);
  assert.deepEqual(Object.keys(enrichment).sort(), ['Flood', 'Heavy rainfall']);
  assert.equal('Cloud burst' in enrichment, false);
});

test('buildUnitKnowledgeEnrichment: a Unit with zero concepts, or zero matches, returns an empty object', () => {
  assert.deepEqual(buildUnitKnowledgeEnrichment({ id: UNIT_ID, concepts: [] }, CONCEPTS, RELATIONSHIPS), {});
  assert.deepEqual(buildUnitKnowledgeEnrichment({ id: 'no-matches-unit', concepts: ['Something'] }, CONCEPTS, RELATIONSHIPS), {});
});

test('buildUnitKnowledgeEnrichment: a missing/undefined unit degrades safely to an empty object', () => {
  assert.deepEqual(buildUnitKnowledgeEnrichment(undefined, CONCEPTS, RELATIONSHIPS), {});
});
