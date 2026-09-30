/**
 * tests/models/knowledgeModelTextbookValidation.test.js
 *
 * VALIDATION FIXTURE — not production code, not UI. Proves that the K1
 * Knowledge Model (models/KnowledgeConcept.js, KnowledgeRelationship.js,
 * KnowledgeClassification.js, KnowledgeClassificationMembership.js) can
 * represent two real textbook structures WITHOUT conflating CURRICULUM
 * STRUCTURE (a textbook's own heading/outline order), KNOWLEDGE MODEL
 * (Concept <-> Concept via typed Relationship), and CLASSIFICATION MODEL
 * (Classification -> Category -> Concept membership).
 *
 * Every record below is built with the REAL model factory functions —
 * this is not a description of what K1 *could* do, it is what K1
 * *actually does* when fed these two textbook excerpts. No Firestore
 * involved (these are plain model objects); no production
 * data/UI/importer is touched or implied by this file's existence.
 *
 * CASE A source text:
 *   Floods
 *     Causes of floods
 *       Meteorological factors
 *         Heavy rainfall / Tropical cyclones / Cloud burst
 *       Physical factors
 *         Large catchment area / Inadequate drainage arrangement
 *       Human factors
 *         Deforestation / Siltation / Faulty agricultural practices /
 *         Faulty irrigation practices / Collapse of dams /
 *         Accelerated urbanisation
 *
 * CASE B source text:
 *   Hazards
 *     Classification: Based on causes of occurrence
 *       Natural: Flood / Earthquake / Cyclonic storms / Droughts /
 *                Landslides / Tsunamis / Volcanic eruptions
 *       Human-made
 *       Socio-natural
 *     Classification: Based on origin
 *       [categories to be represented independently — NONE supplied]
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeConcept } from '../../js/models/KnowledgeConcept.js';
import { RELATIONSHIP_TYPES, createKnowledgeRelationship } from '../../js/models/KnowledgeRelationship.js';
import { createKnowledgeCategory, createKnowledgeClassification, findKnowledgeCategory } from '../../js/models/KnowledgeClassification.js';
import { createKnowledgeClassificationMembership } from '../../js/models/KnowledgeClassificationMembership.js';

const AUTHORIZING_CLASSROOM_ID = 'classroom-textbook-validation';
const CREATED_BY_UID = 'pm-textbook-validation';

function authored(overrides = {}) {
  return { authorizingClassroomId: AUTHORIZING_CLASSROOM_ID, createdByUid: CREATED_BY_UID, ...overrides };
}

// ---------------------------------------------------------------------
// CASE A — nested textbook structure, flattened into Concepts +
// CAUSES relationships. The grouping headings ("Causes of floods",
// "Meteorological factors", "Physical factors", "Human factors") are
// DELIBERATELY not created as Concepts here — see validation point 5.
// ---------------------------------------------------------------------

const flood = createKnowledgeConcept(authored({ id: 'concept-flood', title: 'Flood' }));

const CASE_A_CAUSE_TITLES = [
  'Heavy rainfall',
  'Tropical cyclones',
  'Cloud burst',
  'Large catchment area',
  'Inadequate drainage arrangement',
  'Deforestation',
  'Siltation',
  'Faulty agricultural practices',
  'Faulty irrigation practices',
  'Collapse of dams',
  'Accelerated urbanisation',
];

const caseAConcepts = CASE_A_CAUSE_TITLES.map((title) =>
  createKnowledgeConcept(authored({ id: `concept-${title.toLowerCase().replace(/\s+/g, '-')}`, title }))
);

// "X CAUSES Flood" for every one of the 11 causes — independent of any
// textbook nesting (validation point 4). No PART_OF/HAS_ASPECT chain
// through "Meteorological factors" etc. is created, because those
// headings were never made into Concepts to relate to in the first
// place (validation point 5).
const caseARelationships = caseAConcepts.map((concept) =>
  createKnowledgeRelationship(
    authored({
      id: `rel-${concept.id}-causes-flood`,
      fromConceptId: concept.id,
      toConceptId: flood.id,
      type: RELATIONSHIP_TYPES.CAUSES,
    })
  )
);

/**
 * The textbook's OWN presentation order/outline — a plain fixture
 * object, NOT a Knowledge Model record of any kind (no KnowledgeConcept,
 * no Classification, nothing importable into knowledgeConcepts/
 * knowledgeRelationships/knowledgeClassifications/
 * knowledgeClassificationMemberships). This is CURRICULUM STRUCTURE's
 * own concern (Grade -> Subject -> Chapter -> Section -> Textbook
 * Content), shown here purely to demonstrate validation point 11: the
 * SAME concept ids the real Knowledge Model graph above already uses
 * can be referenced, in order, by a completely separate outline
 * structure that the Knowledge Model has no field for and no awareness
 * of. Deleting this object entirely would not break a single fact
 * above it.
 */
const caseATextbookOutline = {
  heading: 'Floods',
  sections: [
    {
      heading: 'Causes of floods',
      subsections: [
        { heading: 'Meteorological factors', conceptIds: ['concept-heavy-rainfall', 'concept-tropical-cyclones', 'concept-cloud-burst'] },
        { heading: 'Physical factors', conceptIds: ['concept-large-catchment-area', 'concept-inadequate-drainage-arrangement'] },
        {
          heading: 'Human factors',
          conceptIds: [
            'concept-deforestation',
            'concept-siltation',
            'concept-faulty-agricultural-practices',
            'concept-faulty-irrigation-practices',
            'concept-collapse-of-dams',
            'concept-accelerated-urbanisation',
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------
// CASE B — multiple classification lenses over Hazard/Flood/etc.
// ---------------------------------------------------------------------

const hazard = createKnowledgeConcept(authored({ id: 'concept-hazard', title: 'Hazard' }));

// "Flood IS_A Hazard" — independent of any classification (point 3).
const floodIsAHazard = createKnowledgeRelationship(
  authored({ id: 'rel-flood-is-a-hazard', fromConceptId: flood.id, toConceptId: hazard.id, type: RELATIONSHIP_TYPES.IS_A })
);

const OTHER_NATURAL_HAZARD_TITLES = ['Earthquake', 'Cyclonic storms', 'Droughts', 'Landslides', 'Tsunamis', 'Volcanic eruptions'];
const otherNaturalHazardConcepts = OTHER_NATURAL_HAZARD_TITLES.map((title) =>
  createKnowledgeConcept(authored({ id: `concept-${title.toLowerCase().replace(/\s+/g, '-')}`, title }))
);
const otherNaturalHazardIsARelationships = otherNaturalHazardConcepts.map((concept) =>
  createKnowledgeRelationship(
    authored({ id: `rel-${concept.id}-is-a-hazard`, fromConceptId: concept.id, toConceptId: hazard.id, type: RELATIONSHIP_TYPES.IS_A })
  )
);

// The Classification itself — "Based on causes of occurrence" — is a
// Concept parent to NOTHING. Categories are named options within it
// (point 6, point 7). Human-made/Socio-natural are named in the source
// text with no children listed under them — created as real, empty
// Categories, not invented with membership that wasn't given.
const categoryNatural = createKnowledgeCategory({ id: 'category-natural', name: 'Natural' });
const categoryHumanMade = createKnowledgeCategory({ id: 'category-human-made', name: 'Human-made' });
const categorySocioNatural = createKnowledgeCategory({ id: 'category-socio-natural', name: 'Socio-natural' });

const classificationCausesOfOccurrence = createKnowledgeClassification(
  authored({
    id: 'classification-causes-of-occurrence',
    name: 'Based on causes of occurrence',
    categories: [categoryNatural, categoryHumanMade, categorySocioNatural],
  })
);

// Every Natural-hazard Concept (Flood + the other 6) gets its OWN
// ClassificationMembership row placing it in the Natural Category —
// none of this touches Concept.parentId (there is no such field) and
// none of it duplicates the Concept itself (point 10).
const naturalHazardConcepts = [flood, ...otherNaturalHazardConcepts];
const naturalCategoryMemberships = naturalHazardConcepts.map((concept) =>
  createKnowledgeClassificationMembership(
    authored({
      id: `membership-${concept.id}-natural-causes-of-occurrence`,
      conceptId: concept.id,
      classificationId: classificationCausesOfOccurrence.id,
      categoryId: categoryNatural.id,
    })
  )
);

// "Based on origin" — named in the source text, but the source text
// supplies NO categories under it ("[categories to be represented
// independently]"). Per explicit instruction: do not invent categories
// for it. The Classification record itself is still perfectly valid
// with an empty categories[] — naming a lens does not require its
// options to be decided yet.
const classificationBasedOnOrigin = createKnowledgeClassification(
  authored({ id: 'classification-based-on-origin', name: 'Based on origin', categories: [] })
);

/**
 * ILLUSTRATIVE ONLY — proves the "same Concept, second independent
 * membership under a second Classification" mechanism (point 9)
 * without inventing any category for "Based on origin" (which the
 * source text does not supply). This Classification/Category pair is
 * NOT sourced from either textbook excerpt and must never be read as a
 * real proposed taxonomy — it exists purely so this test can assert
 * the mechanism works, using data that is clearly marked as synthetic
 * rather than quietly inventing a "based on origin" category the
 * source text withheld.
 */
const illustrativeClassification = createKnowledgeClassification(
  authored({
    id: 'classification-illustrative-mechanism-proof',
    name: 'ILLUSTRATIVE ONLY (not sourced from the provided textbook text)',
    categories: [createKnowledgeCategory({ id: 'category-illustrative', name: 'ILLUSTRATIVE ONLY' })],
  })
);
const floodSecondMembership = createKnowledgeClassificationMembership(
  authored({
    id: 'membership-flood-illustrative',
    conceptId: flood.id,
    classificationId: illustrativeClassification.id,
    categoryId: 'category-illustrative',
  })
);

// =======================================================================
// Validation
// =======================================================================

test('1. "Flood" can be a Concept', () => {
  assert.equal(flood.title, 'Flood');
  assert.ok(flood.id);
});

test('2. "Hazard" can be a Concept', () => {
  assert.equal(hazard.title, 'Hazard');
  assert.ok(hazard.id);
});

test('3. "Flood IS_A Hazard" exists independently of any classification', () => {
  assert.equal(floodIsAHazard.fromConceptId, flood.id);
  assert.equal(floodIsAHazard.toConceptId, hazard.id);
  assert.equal(floodIsAHazard.type, 'IS_A');
  // No classification/category id appears anywhere on the relationship.
  assert.equal('classificationId' in floodIsAHazard, false);
  assert.equal('categoryId' in floodIsAHazard, false);
});

test('4. "Heavy rainfall CAUSES Flood" exists independently of textbook nesting', () => {
  const heavyRainfall = caseAConcepts.find((c) => c.title === 'Heavy rainfall');
  const relationship = caseARelationships.find((r) => r.fromConceptId === heavyRainfall.id);
  assert.equal(relationship.toConceptId, flood.id);
  assert.equal(relationship.type, 'CAUSES');
  // The relationship carries no reference to "Meteorological factors"
  // or "Causes of floods" at all — it is a two-Concept fact, full stop.
});

test('5. "Meteorological factors" does not become a parent Concept merely because it is a textbook heading', () => {
  const allConceptTitles = [flood, hazard, ...caseAConcepts, ...otherNaturalHazardConcepts].map((c) => c.title);
  assert.equal(allConceptTitles.includes('Meteorological factors'), false);
  assert.equal(allConceptTitles.includes('Physical factors'), false);
  assert.equal(allConceptTitles.includes('Human factors'), false);
  assert.equal(allConceptTitles.includes('Causes of floods'), false);
});

test('6. "Based on causes of occurrence" is a Classification, never a Concept parent', () => {
  assert.equal(classificationCausesOfOccurrence.name, 'Based on causes of occurrence');
  // It is not, and cannot be, referenced as any Concept's parent — no
  // such field exists on KnowledgeConcept to point at it (see test 10
  // below for the direct field-absence assertion).
  assert.ok(Array.isArray(classificationCausesOfOccurrence.categories));
});

test('7. "Natural" is a Category within that Classification, not a standalone entity', () => {
  const found = findKnowledgeCategory(classificationCausesOfOccurrence, categoryNatural.id);
  assert.deepEqual(found, categoryNatural);
  assert.equal(found.name, 'Natural');
});

test('8. Flood belongs to Natural within "Based on causes of occurrence"', () => {
  const membership = naturalCategoryMemberships.find((m) => m.conceptId === flood.id);
  assert.equal(membership.classificationId, classificationCausesOfOccurrence.id);
  assert.equal(membership.categoryId, categoryNatural.id);
});

test('9. The same Flood Concept simultaneously belongs to a different Category under a different Classification', () => {
  const firstMembership = naturalCategoryMemberships.find((m) => m.conceptId === flood.id);
  assert.equal(floodSecondMembership.conceptId, flood.id);
  assert.notEqual(floodSecondMembership.classificationId, firstMembership.classificationId);
  assert.notEqual(floodSecondMembership.categoryId, firstMembership.categoryId);
  // Both memberships reference the exact same underlying Concept id —
  // see test 10 for why this never means two Flood documents exist.
  assert.equal(floodSecondMembership.conceptId, firstMembership.conceptId);
});

test('10. No Concept is duplicated merely because it appears in multiple classifications', () => {
  const allConcepts = [flood, hazard, ...caseAConcepts, ...otherNaturalHazardConcepts];
  const floodConceptDocuments = allConcepts.filter((c) => c.title === 'Flood');
  assert.equal(floodConceptDocuments.length, 1, 'exactly one Flood Concept document exists, despite two ClassificationMemberships and one IS_A relationship referencing it');
  // Reinforces the K1 design rule directly: no parent/category field of
  // any kind exists on the Concept itself.
  assert.equal('parentId' in flood, false);
  assert.equal('categoryId' in flood, false);
  assert.equal('classificationId' in flood, false);
});

test('11. Textbook presentation order exists independently of knowledge relationships', () => {
  // The outline references real concept ids...
  const outlineConceptIds = caseATextbookOutline.sections[0].subsections.flatMap((s) => s.conceptIds);
  assert.equal(outlineConceptIds.length, CASE_A_CAUSE_TITLES.length);
  outlineConceptIds.forEach((id) => {
    assert.ok(caseAConcepts.some((c) => c.id === id), `${id} is a real Concept the outline points at`);
  });
  // ...but nothing on KnowledgeConcept or KnowledgeRelationship stores
  // or depends on this order, or on the outline's own heading text.
  caseAConcepts.forEach((concept) => {
    assert.equal('order' in concept, false);
    assert.equal('sectionHeading' in concept, false);
  });
  caseARelationships.forEach((relationship) => {
    assert.equal('order' in relationship, false);
  });
});

test('Bonus: Flood authored in Case A ("has causes") and Case B ("is a Hazard") is the exact same Concept document, not two', () => {
  assert.equal(floodIsAHazard.fromConceptId, flood.id);
  assert.equal(caseARelationships[0].toConceptId, flood.id);
});

test('"Based on origin" is represented with zero invented categories, as instructed', () => {
  assert.equal(classificationBasedOnOrigin.name, 'Based on origin');
  assert.deepEqual(classificationBasedOnOrigin.categories, []);
});

test('Human-made and Socio-natural exist as real, valid, currently-empty Categories (no invented membership)', () => {
  assert.ok(findKnowledgeCategory(classificationCausesOfOccurrence, categoryHumanMade.id));
  assert.ok(findKnowledgeCategory(classificationCausesOfOccurrence, categorySocioNatural.id));
  const anyMembershipInHumanMadeOrSocioNatural = naturalCategoryMemberships.some(
    (m) => m.categoryId === categoryHumanMade.id || m.categoryId === categorySocioNatural.id
  );
  assert.equal(anyMembershipInHumanMadeOrSocioNatural, false);
});

test('every one of the 6 additional Natural hazards from Case B is IS_A Hazard AND a member of Natural, via two independent record types', () => {
  otherNaturalHazardConcepts.forEach((concept) => {
    const isARelationship = otherNaturalHazardIsARelationships.find((r) => r.fromConceptId === concept.id);
    const membership = naturalCategoryMemberships.find((m) => m.conceptId === concept.id);
    assert.equal(isARelationship.toConceptId, hazard.id);
    assert.equal(membership.categoryId, categoryNatural.id);
  });
});
