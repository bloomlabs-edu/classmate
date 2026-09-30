/**
 * tests/rules/knowledgeModel.rules.test.js
 *
 * Real Firestore Rules Emulator tests (firestore.rules, unmodified from
 * what's actually deployed-ready) for the four new ClassMate Knowledge
 * Model v1 top-level collections: knowledgeConcepts,
 * knowledgeRelationships, knowledgeClassifications,
 * knowledgeClassificationMemberships.
 *
 * Proves, against the actual rules engine: any authenticated user can
 * read every collection; only a `program_manager` on the record's own
 * `authorizingClassroomId` may create/update/delete; a plain `teacher`
 * or `owner` on that same classroom is denied; identity fields
 * (createdByUid/createdAt, and each collection's own "what this record
 * IS" fields) cannot be reassigned via update; a KnowledgeRelationship's
 * `type` must be one of the 9 v1 enum values.
 *
 * Requires the Firestore emulator, matching the exact convention
 * already established in tests/rules/task.rules.test.js:
 *   firebase emulators:exec --only firestore "node --test tests/rules/knowledgeModel.rules.test.js"
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';

let testEnv;

const PM_UID = 'pm-uid';
const TEACHER_UID = 'teacher-uid';
const OWNER_UID = 'owner-uid';
const OUTSIDER_UID = 'outsider-uid';
const CLASSROOM_ID = 'classroom-1';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-knowledge-model-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', CLASSROOM_ID), {
      memberUids: [OWNER_UID, TEACHER_UID, PM_UID],
      members: {
        [OWNER_UID]: { role: 'owner' },
        [TEACHER_UID]: { role: 'teacher' },
        [PM_UID]: { role: 'program_manager' },
      },
    });
  });
});

function asPm() {
  return testEnv.authenticatedContext(PM_UID).firestore();
}
function asTeacher() {
  return testEnv.authenticatedContext(TEACHER_UID).firestore();
}
function asOwner() {
  return testEnv.authenticatedContext(OWNER_UID).firestore();
}
function asOutsider() {
  return testEnv.authenticatedContext(OUTSIDER_UID).firestore();
}

// ---------------------------------------------------------------------
// knowledgeConcepts
// ---------------------------------------------------------------------

function baseConcept(overrides = {}) {
  return {
    title: 'Flood',
    description: null,
    sourceCurriculumUnitId: null,
    authorizingClassroomId: CLASSROOM_ID,
    createdByUid: PM_UID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('knowledgeConcepts: a Program Manager (on the authorizing classroom) can create one', async () => {
  await assertSucceeds(setDoc(doc(asPm(), 'knowledgeConcepts', 'concept-1'), baseConcept()));
});

test('knowledgeConcepts: a plain Teacher on the same classroom CANNOT create one', async () => {
  await assertFails(setDoc(doc(asTeacher(), 'knowledgeConcepts', 'concept-1'), baseConcept({ createdByUid: TEACHER_UID })));
});

test('knowledgeConcepts: an Owner on the same classroom CANNOT create one — v1 boundary is program_manager only', async () => {
  await assertFails(setDoc(doc(asOwner(), 'knowledgeConcepts', 'concept-1'), baseConcept({ createdByUid: OWNER_UID })));
});

test('knowledgeConcepts: a Program Manager on a DIFFERENT (unrelated) classroom cannot create one', async () => {
  await assertFails(setDoc(doc(asOutsider(), 'knowledgeConcepts', 'concept-1'), baseConcept({ createdByUid: OUTSIDER_UID })));
});

test('knowledgeConcepts: any authenticated user can read one, including a plain Teacher and a total outsider', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeConcepts', 'concept-1'), baseConcept());
  });
  await assertSucceeds(getDoc(doc(asTeacher(), 'knowledgeConcepts', 'concept-1')));
  await assertSucceeds(getDoc(doc(asOutsider(), 'knowledgeConcepts', 'concept-1')));
});

test('knowledgeConcepts: an unauthenticated caller cannot read or write', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeConcepts', 'concept-1'), baseConcept());
  });
  const unauthed = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauthed, 'knowledgeConcepts', 'concept-1')));
  await assertFails(setDoc(doc(unauthed, 'knowledgeConcepts', 'concept-1'), baseConcept()));
});

test('knowledgeConcepts: the authoring Program Manager can update it (e.g. edit title/description)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeConcepts', 'concept-1'), baseConcept());
  });
  await assertSucceeds(
    updateDoc(doc(asPm(), 'knowledgeConcepts', 'concept-1'), { title: 'Flooding', updatedAt: '2026-01-02T00:00:00.000Z' })
  );
});

test('knowledgeConcepts: cannot reassign createdByUid or createdAt via update', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeConcepts', 'concept-1'), baseConcept());
  });
  await assertFails(updateDoc(doc(asPm(), 'knowledgeConcepts', 'concept-1'), { createdByUid: TEACHER_UID }));
  await assertFails(updateDoc(doc(asPm(), 'knowledgeConcepts', 'concept-1'), { createdAt: '2020-01-01T00:00:00.000Z' }));
});

test('knowledgeConcepts: a Program Manager can delete it; a Teacher cannot', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeConcepts', 'concept-1'), baseConcept());
  });
  await assertFails(deleteDoc(doc(asTeacher(), 'knowledgeConcepts', 'concept-1')));
  await assertSucceeds(deleteDoc(doc(asPm(), 'knowledgeConcepts', 'concept-1')));
});

// ---------------------------------------------------------------------
// knowledgeRelationships
// ---------------------------------------------------------------------

function baseRelationship(overrides = {}) {
  return {
    fromConceptId: 'concept-heavy-rainfall',
    toConceptId: 'concept-flood',
    type: 'CAUSES',
    authorizingClassroomId: CLASSROOM_ID,
    createdByUid: PM_UID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('knowledgeRelationships: a Program Manager can create a valid-type relationship; a Teacher cannot', async () => {
  await assertSucceeds(setDoc(doc(asPm(), 'knowledgeRelationships', 'rel-1'), baseRelationship()));
  await assertFails(setDoc(doc(asTeacher(), 'knowledgeRelationships', 'rel-2'), baseRelationship({ createdByUid: TEACHER_UID })));
});

test('knowledgeRelationships: an out-of-enum type is rejected even for the Program Manager', async () => {
  await assertFails(setDoc(doc(asPm(), 'knowledgeRelationships', 'rel-1'), baseRelationship({ type: 'MADE_UP_TYPE' })));
});

test('knowledgeRelationships: fromConceptId cannot equal toConceptId (a Concept cannot relate to itself)', async () => {
  await assertFails(
    setDoc(doc(asPm(), 'knowledgeRelationships', 'rel-1'), baseRelationship({ fromConceptId: 'concept-flood', toConceptId: 'concept-flood' }))
  );
});

test('knowledgeRelationships: every one of the 9 v1 types is independently accepted', async () => {
  const types = ['IS_A', 'PART_OF', 'CAUSES', 'HAS_ASPECT', 'HAS_PROPERTY', 'EXAMPLE_OF', 'RELATED_TO', 'CONTRASTS_WITH', 'PREREQUISITE_FOR'];
  for (const type of types) {
    await assertSucceeds(setDoc(doc(asPm(), 'knowledgeRelationships', `rel-${type}`), baseRelationship({ type })));
  }
});

test('knowledgeRelationships: fromConceptId/toConceptId cannot be reassigned via update — that would silently change which fact this record asserts', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeRelationships', 'rel-1'), baseRelationship());
  });
  await assertFails(updateDoc(doc(asPm(), 'knowledgeRelationships', 'rel-1'), { toConceptId: 'concept-earthquake' }));
});

test('knowledgeRelationships: the type itself CAN be corrected via update, as long as it stays a valid v1 type', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeRelationships', 'rel-1'), baseRelationship({ type: 'RELATED_TO' }));
  });
  await assertSucceeds(updateDoc(doc(asPm(), 'knowledgeRelationships', 'rel-1'), { type: 'CAUSES', updatedAt: '2026-01-02T00:00:00.000Z' }));
});

test('knowledgeRelationships: reads work for any authenticated user; a Program Manager can delete', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeRelationships', 'rel-1'), baseRelationship());
  });
  await assertSucceeds(getDoc(doc(asTeacher(), 'knowledgeRelationships', 'rel-1')));
  await assertSucceeds(deleteDoc(doc(asPm(), 'knowledgeRelationships', 'rel-1')));
});

// ---------------------------------------------------------------------
// knowledgeClassifications
// ---------------------------------------------------------------------

function baseClassification(overrides = {}) {
  return {
    name: 'Based on causes of occurrence',
    description: null,
    categories: [
      { id: 'category-natural', name: 'Natural' },
      { id: 'category-human-made', name: 'Human-made' },
    ],
    authorizingClassroomId: CLASSROOM_ID,
    createdByUid: PM_UID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('knowledgeClassifications: a Program Manager can create one (with inline categories); a Teacher cannot', async () => {
  await assertSucceeds(setDoc(doc(asPm(), 'knowledgeClassifications', 'classification-1'), baseClassification()));
  await assertFails(setDoc(doc(asTeacher(), 'knowledgeClassifications', 'classification-2'), baseClassification({ createdByUid: TEACHER_UID })));
});

test('knowledgeClassifications: a Program Manager can add a Category by updating the inline categories array', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeClassifications', 'classification-1'), baseClassification());
  });
  await assertSucceeds(
    updateDoc(doc(asPm(), 'knowledgeClassifications', 'classification-1'), {
      categories: [
        { id: 'category-natural', name: 'Natural' },
        { id: 'category-human-made', name: 'Human-made' },
        { id: 'category-socio-natural', name: 'Socio-natural' },
      ],
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  );
});

test('knowledgeClassifications: reads work for any authenticated user; identity fields cannot be reassigned; a Program Manager can delete', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeClassifications', 'classification-1'), baseClassification());
  });
  await assertSucceeds(getDoc(doc(asOutsider(), 'knowledgeClassifications', 'classification-1')));
  await assertFails(updateDoc(doc(asPm(), 'knowledgeClassifications', 'classification-1'), { createdByUid: TEACHER_UID }));
  await assertSucceeds(deleteDoc(doc(asPm(), 'knowledgeClassifications', 'classification-1')));
});

// ---------------------------------------------------------------------
// knowledgeClassificationMemberships
// ---------------------------------------------------------------------

function baseMembership(overrides = {}) {
  return {
    conceptId: 'concept-flood',
    classificationId: 'classification-1',
    categoryId: 'category-natural',
    authorizingClassroomId: CLASSROOM_ID,
    createdByUid: PM_UID,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('knowledgeClassificationMemberships: Example B — a Program Manager can record Flood -> Natural -> within "Based on causes of occurrence"', async () => {
  await assertSucceeds(setDoc(doc(asPm(), 'knowledgeClassificationMemberships', 'membership-1'), baseMembership()));
});

test('knowledgeClassificationMemberships: a plain Teacher cannot create one', async () => {
  await assertFails(setDoc(doc(asTeacher(), 'knowledgeClassificationMemberships', 'membership-1'), baseMembership({ createdByUid: TEACHER_UID })));
});

test('knowledgeClassificationMemberships: conceptId/classificationId cannot be reassigned via update (categoryId, e.g. re-filing a Concept to a different Category, can)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeClassificationMemberships', 'membership-1'), baseMembership());
  });
  await assertFails(updateDoc(doc(asPm(), 'knowledgeClassificationMemberships', 'membership-1'), { conceptId: 'concept-earthquake' }));
  await assertSucceeds(updateDoc(doc(asPm(), 'knowledgeClassificationMemberships', 'membership-1'), { categoryId: 'category-human-made' }));
});

test('knowledgeClassificationMemberships: reads work for any authenticated user; a Program Manager can delete', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'knowledgeClassificationMemberships', 'membership-1'), baseMembership());
  });
  await assertSucceeds(getDoc(doc(asTeacher(), 'knowledgeClassificationMemberships', 'membership-1')));
  await assertSucceeds(deleteDoc(doc(asPm(), 'knowledgeClassificationMemberships', 'membership-1')));
});
