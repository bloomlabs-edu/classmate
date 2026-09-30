import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterConceptsByQuery,
  buildConceptPickerOptions,
  buildRelationshipRows,
  filterRelationshipRowsByQuery,
  isSymmetricRelationshipType,
  findDuplicateRelationship,
  buildClassificationBlocks,
  buildCategoryOptions,
  findMembershipForConceptInClassification,
  extractTextbookItemTitles,
  createInitialTextbookItemStates,
  setTextbookItemState,
  findConceptByExactTitle,
} from '../../js/ui/views/KnowledgeAuthoringDisplay.js';
import { RELATIONSHIP_TYPES } from '../../js/models/KnowledgeRelationship.js';

const CONCEPTS = [
  { id: 'concept-flood', title: 'Flood' },
  { id: 'concept-earthquake', title: 'Earthquake' },
  { id: 'concept-tropical-cyclones', title: 'Tropical cyclones' },
  { id: 'concept-hazard', title: 'Hazard' },
  { id: 'concept-heavy-rainfall', title: 'Heavy rainfall' },
];

test('filterConceptsByQuery: substring match, case-insensitive', () => {
  const result = filterConceptsByQuery(CONCEPTS, 'flo');
  assert.deepEqual(result.map((c) => c.title), ['Flood']);
});

test('filterConceptsByQuery: an empty/blank query returns every concept unfiltered', () => {
  assert.equal(filterConceptsByQuery(CONCEPTS, '').length, CONCEPTS.length);
  assert.equal(filterConceptsByQuery(CONCEPTS, '   ').length, CONCEPTS.length);
  assert.equal(filterConceptsByQuery(CONCEPTS, undefined).length, CONCEPTS.length);
});

test('filterConceptsByQuery: never fuzzy-matches a near-synonym — "cyclonic storms" does not match "Tropical cyclones"', () => {
  const result = filterConceptsByQuery(CONCEPTS, 'cyclonic storms');
  assert.deepEqual(result, []);
});

test('filterConceptsByQuery: a missing/undefined concepts argument degrades safely to an empty array', () => {
  assert.deepEqual(filterConceptsByQuery(undefined, 'flood'), []);
});

test('buildConceptPickerOptions: maps to {value: id, label: title}, sorted alphabetically by title', () => {
  const options = buildConceptPickerOptions(CONCEPTS);
  assert.deepEqual(options, [
    { value: 'concept-earthquake', label: 'Earthquake' },
    { value: 'concept-flood', label: 'Flood' },
    { value: 'concept-hazard', label: 'Hazard' },
    { value: 'concept-heavy-rainfall', label: 'Heavy rainfall' },
    { value: 'concept-tropical-cyclones', label: 'Tropical cyclones' },
  ]);
});

test('buildConceptPickerOptions: a missing/undefined concepts argument degrades safely to an empty array', () => {
  assert.deepEqual(buildConceptPickerOptions(undefined), []);
});

// ---------------------------------------------------------------------
// buildRelationshipRows / filterRelationshipRowsByQuery
// ---------------------------------------------------------------------

const RELATIONSHIPS = [
  { id: 'rel-1', fromConceptId: 'concept-heavy-rainfall', toConceptId: 'concept-flood', type: RELATIONSHIP_TYPES.CAUSES },
  { id: 'rel-2', fromConceptId: 'concept-flood', toConceptId: 'concept-hazard', type: RELATIONSHIP_TYPES.IS_A },
];

test('buildRelationshipRows: resolves real Concept titles, the forward label, and a full reverse sentence', () => {
  const rows = buildRelationshipRows(RELATIONSHIPS, CONCEPTS);
  assert.equal(rows[0].fromTitle, 'Heavy rainfall');
  assert.equal(rows[0].toTitle, 'Flood');
  assert.equal(rows[0].forwardLabel, 'causes');
  assert.equal(rows[0].reverseSentence, 'Flood is caused by Heavy rainfall');
  assert.equal(rows[1].fromTitle, 'Flood');
  assert.equal(rows[1].toTitle, 'Hazard');
  assert.equal(rows[1].forwardLabel, 'is a');
  assert.equal(rows[1].reverseSentence, 'Hazard includes Flood');
});

test('buildRelationshipRows: a relationship pointing at a deleted/unknown Concept still renders, with an honest placeholder', () => {
  const rows = buildRelationshipRows([{ id: 'rel-x', fromConceptId: 'concept-ghost', toConceptId: 'concept-flood', type: RELATIONSHIP_TYPES.CAUSES }], CONCEPTS);
  assert.equal(rows[0].fromTitle, '(unknown Concept)');
  assert.equal(rows[0].toTitle, 'Flood');
});

test('buildRelationshipRows: a missing/undefined relationships argument degrades safely to an empty array', () => {
  assert.deepEqual(buildRelationshipRows(undefined, CONCEPTS), []);
});

test('filterRelationshipRowsByQuery: matches by either Concept title, case-insensitive', () => {
  const rows = buildRelationshipRows(RELATIONSHIPS, CONCEPTS);
  assert.deepEqual(filterRelationshipRowsByQuery(rows, 'hazard').map((r) => r.id), ['rel-2']);
  assert.deepEqual(filterRelationshipRowsByQuery(rows, 'RAINFALL').map((r) => r.id), ['rel-1']);
});

test('filterRelationshipRowsByQuery: matches by the forward relationship-type label too', () => {
  const rows = buildRelationshipRows(RELATIONSHIPS, CONCEPTS);
  assert.deepEqual(filterRelationshipRowsByQuery(rows, 'causes').map((r) => r.id), ['rel-1']);
});

test('filterRelationshipRowsByQuery: an empty/blank query returns every row unfiltered', () => {
  const rows = buildRelationshipRows(RELATIONSHIPS, CONCEPTS);
  assert.equal(filterRelationshipRowsByQuery(rows, '').length, 2);
});

// ---------------------------------------------------------------------
// isSymmetricRelationshipType / findDuplicateRelationship
// ---------------------------------------------------------------------

test('isSymmetricRelationshipType: RELATED_TO and CONTRASTS_WITH are symmetric; CAUSES/IS_A are not', () => {
  assert.equal(isSymmetricRelationshipType(RELATIONSHIP_TYPES.RELATED_TO), true);
  assert.equal(isSymmetricRelationshipType(RELATIONSHIP_TYPES.CONTRASTS_WITH), true);
  assert.equal(isSymmetricRelationshipType(RELATIONSHIP_TYPES.CAUSES), false);
  assert.equal(isSymmetricRelationshipType(RELATIONSHIP_TYPES.IS_A), false);
});

test('findDuplicateRelationship: the exact same {from, to, type} triple is a duplicate', () => {
  const duplicate = findDuplicateRelationship(RELATIONSHIPS, {
    fromConceptId: 'concept-heavy-rainfall',
    toConceptId: 'concept-flood',
    type: RELATIONSHIP_TYPES.CAUSES,
  });
  assert.equal(duplicate.id, 'rel-1');
});

test('findDuplicateRelationship: a different type between the same two Concepts is NOT a duplicate', () => {
  const duplicate = findDuplicateRelationship(RELATIONSHIPS, {
    fromConceptId: 'concept-heavy-rainfall',
    toConceptId: 'concept-flood',
    type: RELATIONSHIP_TYPES.RELATED_TO,
  });
  assert.equal(duplicate, null);
});

test('findDuplicateRelationship: an ASYMMETRIC type reversed (Flood CAUSES Heavy rainfall) is NOT a duplicate of Heavy rainfall CAUSES Flood', () => {
  const duplicate = findDuplicateRelationship(RELATIONSHIPS, {
    fromConceptId: 'concept-flood',
    toConceptId: 'concept-heavy-rainfall',
    type: RELATIONSHIP_TYPES.CAUSES,
  });
  assert.equal(duplicate, null);
});

test('findDuplicateRelationship: a SYMMETRIC type reversed IS a duplicate — "Hazard RELATED_TO Flood" duplicates an existing "Flood RELATED_TO Hazard"', () => {
  const existing = [{ id: 'rel-related', fromConceptId: 'concept-flood', toConceptId: 'concept-hazard', type: RELATIONSHIP_TYPES.RELATED_TO }];
  const duplicate = findDuplicateRelationship(existing, {
    fromConceptId: 'concept-hazard',
    toConceptId: 'concept-flood',
    type: RELATIONSHIP_TYPES.RELATED_TO,
  });
  assert.equal(duplicate.id, 'rel-related');
});

test('findDuplicateRelationship: no match returns null, never a guess', () => {
  assert.equal(
    findDuplicateRelationship(RELATIONSHIPS, { fromConceptId: 'concept-earthquake', toConceptId: 'concept-hazard', type: RELATIONSHIP_TYPES.IS_A }),
    null
  );
});

// ---------------------------------------------------------------------
// buildClassificationBlocks / buildCategoryOptions / findMembershipForConceptInClassification
// ---------------------------------------------------------------------

const CLASSIFICATIONS = [
  {
    id: 'classification-causes',
    name: 'Based on causes of occurrence',
    description: null,
    categories: [
      { id: 'category-natural', name: 'Natural' },
      { id: 'category-human-made', name: 'Human-made' },
      { id: 'category-socio-natural', name: 'Socio-natural' },
    ],
  },
  {
    id: 'classification-origin',
    name: 'Based on origin',
    description: null,
    categories: [],
  },
];

const MEMBERSHIPS = [
  { id: 'membership-1', conceptId: 'concept-flood', classificationId: 'classification-causes', categoryId: 'category-natural' },
  { id: 'membership-2', conceptId: 'concept-earthquake', classificationId: 'classification-causes', categoryId: 'category-natural' },
];

test('buildClassificationBlocks: each Category lists the real Concepts currently assigned to it, via membership', () => {
  const blocks = buildClassificationBlocks(CLASSIFICATIONS, MEMBERSHIPS, CONCEPTS);
  const causes = blocks.find((b) => b.id === 'classification-causes');
  const natural = causes.categories.find((c) => c.id === 'category-natural');
  assert.deepEqual(
    natural.assignedConcepts.map((a) => a.title),
    ['Flood', 'Earthquake']
  );
});

test('buildClassificationBlocks: a Category with zero memberships remains present with an empty assignedConcepts array (K2.3 requirement 7)', () => {
  const blocks = buildClassificationBlocks(CLASSIFICATIONS, MEMBERSHIPS, CONCEPTS);
  const causes = blocks.find((b) => b.id === 'classification-causes');
  const humanMade = causes.categories.find((c) => c.id === 'category-human-made');
  assert.deepEqual(humanMade.assignedConcepts, []);
});

test('buildClassificationBlocks: a Classification with zero Categories remains present and valid (K2.3 requirement 8)', () => {
  const blocks = buildClassificationBlocks(CLASSIFICATIONS, MEMBERSHIPS, CONCEPTS);
  const origin = blocks.find((b) => b.id === 'classification-origin');
  assert.deepEqual(origin.categories, []);
});

test('buildClassificationBlocks: a membership referencing a deleted/unknown Concept still renders, with an honest placeholder', () => {
  const blocks = buildClassificationBlocks(
    CLASSIFICATIONS,
    [{ id: 'membership-ghost', conceptId: 'concept-ghost', classificationId: 'classification-causes', categoryId: 'category-natural' }],
    CONCEPTS
  );
  const natural = blocks.find((b) => b.id === 'classification-causes').categories.find((c) => c.id === 'category-natural');
  assert.equal(natural.assignedConcepts[0].title, '(unknown Concept)');
});

test('buildClassificationBlocks: missing/undefined arguments degrade safely to an empty array', () => {
  assert.deepEqual(buildClassificationBlocks(undefined, undefined, undefined), []);
});

test('buildCategoryOptions: maps to {value, label} in the Classification\'s own authored order — never re-sorted', () => {
  const options = buildCategoryOptions(CLASSIFICATIONS[0]);
  assert.deepEqual(options, [
    { value: 'category-natural', label: 'Natural' },
    { value: 'category-human-made', label: 'Human-made' },
    { value: 'category-socio-natural', label: 'Socio-natural' },
  ]);
});

test('buildCategoryOptions: a Classification with zero Categories returns an empty array, not an error', () => {
  assert.deepEqual(buildCategoryOptions(CLASSIFICATIONS[1]), []);
});

test('buildCategoryOptions: a missing/undefined Classification degrades safely to an empty array', () => {
  assert.deepEqual(buildCategoryOptions(undefined), []);
});

test('findMembershipForConceptInClassification: finds the one existing membership for this Concept within this Classification', () => {
  const membership = findMembershipForConceptInClassification(MEMBERSHIPS, { conceptId: 'concept-flood', classificationId: 'classification-causes' });
  assert.equal(membership.id, 'membership-1');
});

test('findMembershipForConceptInClassification: the SAME Concept under a DIFFERENT Classification is correctly ignored (K2.3 requirement 6)', () => {
  const membership = findMembershipForConceptInClassification(MEMBERSHIPS, { conceptId: 'concept-flood', classificationId: 'classification-origin' });
  assert.equal(membership, null);
});

test('findMembershipForConceptInClassification: no existing membership returns null, never a guess', () => {
  const membership = findMembershipForConceptInClassification(MEMBERSHIPS, { conceptId: 'concept-tropical-cyclones', classificationId: 'classification-causes' });
  assert.equal(membership, null);
});

// ---------------------------------------------------------------------
// extractTextbookItemTitles / createInitialTextbookItemStates /
// setTextbookItemState / findConceptByExactTitle (K2.4)
// ---------------------------------------------------------------------

test('extractTextbookItemTitles: returns a NEW array of the Unit\'s own concept titles, never the same reference (no accidental curriculum mutation)', () => {
  const unit = Object.freeze({ id: 'unit-floods', title: 'Floods', concepts: Object.freeze(['Heavy rainfall', 'Tropical cyclones', 'Cloud burst']) });
  const titles = extractTextbookItemTitles(unit);
  assert.deepEqual(titles, ['Heavy rainfall', 'Tropical cyclones', 'Cloud burst']);
  assert.notEqual(titles, unit.concepts);
  // Frozen input — if this function ever tried to write to `unit` or
  // `unit.concepts`, this call would throw in strict mode. It doesn't.
});

test('extractTextbookItemTitles: a Unit with zero concepts degrades safely to an empty array', () => {
  assert.deepEqual(extractTextbookItemTitles({ id: 'unit-empty', concepts: [] }), []);
});

test('extractTextbookItemTitles: a missing/undefined Unit degrades safely to an empty array', () => {
  assert.deepEqual(extractTextbookItemTitles(undefined), []);
});

test('createInitialTextbookItemStates: every item starts undecided, with no Concept id yet', () => {
  const states = createInitialTextbookItemStates(['Heavy rainfall', 'Meteorological factors']);
  assert.deepEqual(states, [
    { title: 'Heavy rainfall', status: 'undecided', conceptId: null, conceptLabel: null },
    { title: 'Meteorological factors', status: 'undecided', conceptId: null, conceptLabel: null },
  ]);
});

test('createInitialTextbookItemStates: two items sharing an identical title are tracked independently, by index', () => {
  const states = createInitialTextbookItemStates(['Erosion', 'Erosion']);
  assert.equal(states.length, 2);
  assert.notEqual(states[0], states[1]);
});

test('setTextbookItemState: "Leave as Heading" — no Concept id, and creates NO Knowledge Model record (asserted by the absence of any conceptId)', () => {
  const initial = createInitialTextbookItemStates(['Meteorological factors']);
  const updated = setTextbookItemState(initial, 0, { status: 'heading' });
  assert.deepEqual(updated[0], { title: 'Meteorological factors', status: 'heading', conceptId: null, conceptLabel: null });
});

test('setTextbookItemState: "Use Existing Concept" records the chosen Concept\'s id/label', () => {
  const initial = createInitialTextbookItemStates(['Flood']);
  const updated = setTextbookItemState(initial, 0, { status: 'existing', conceptId: 'concept-flood', conceptLabel: 'Flood' });
  assert.equal(updated[0].status, 'existing');
  assert.equal(updated[0].conceptId, 'concept-flood');
});

test('setTextbookItemState: "Create New Concept" records the newly-created Concept\'s id/label', () => {
  const initial = createInitialTextbookItemStates(['Heavy rainfall']);
  const updated = setTextbookItemState(initial, 0, { status: 'created', conceptId: 'concept-heavy-rainfall', conceptLabel: 'Heavy rainfall' });
  assert.equal(updated[0].status, 'created');
  assert.equal(updated[0].conceptId, 'concept-heavy-rainfall');
});

test('setTextbookItemState: only the targeted item changes — every other item stays the exact same object reference', () => {
  const initial = createInitialTextbookItemStates(['A', 'B', 'C']);
  const updated = setTextbookItemState(initial, 1, { status: 'heading' });
  assert.equal(updated[0], initial[0]);
  assert.equal(updated[2], initial[2]);
  assert.notEqual(updated[1], initial[1]);
});

test('setTextbookItemState: does not mutate its input array', () => {
  const initial = createInitialTextbookItemStates(['A']);
  const originalFirst = initial[0];
  setTextbookItemState(initial, 0, { status: 'heading' });
  assert.equal(initial[0], originalFirst);
  assert.equal(initial[0].status, 'undecided');
});

test('findConceptByExactTitle: an exact, case-insensitive title match is found (duplicate-title behavior consistent with K2.1)', () => {
  assert.deepEqual(findConceptByExactTitle(CONCEPTS, 'flood'), CONCEPTS[0]);
  assert.deepEqual(findConceptByExactTitle(CONCEPTS, 'FLOOD'), CONCEPTS[0]);
});

test('findConceptByExactTitle: a near-miss/partial title is never treated as a match — only a true exact spelling collision counts', () => {
  assert.equal(findConceptByExactTitle(CONCEPTS, 'Flo'), null);
  assert.equal(findConceptByExactTitle(CONCEPTS, 'Cyclonic storms'), null);
});

test('findConceptByExactTitle: no match returns null, never a guess', () => {
  assert.equal(findConceptByExactTitle(CONCEPTS, ''), null);
  assert.equal(findConceptByExactTitle(undefined, 'Flood'), null);
});
