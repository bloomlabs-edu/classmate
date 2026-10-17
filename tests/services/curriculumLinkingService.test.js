/**
 * tests/services/curriculumLinkingService.test.js
 *
 * Verification for the LOCKED decision to reuse Curriculum Index's
 * existing `parts[]` mechanism for curriculum-specific term structure
 * (Grade 6/7 Science: Part = "Term 1"/"Term 2"/"Term 3"; Grade 8
 * Science: no Parts at all, flat Unit list) — NOT a test of a new
 * feature, since no data model or service code changed for this
 * decision. Proves the existing, unmodified
 * services/curriculumLinkingService.js and
 * services/learningRecordTeacherService.js already produce correct,
 * stable results for this exact usage pattern.
 *
 * The Learning Management grouping check (below) deliberately
 * reproduces ui/views/LearningManagementView.js's own `distinctPartNames`
 * derivation verbatim (see that file's `renderUnitsOrParts()`) rather
 * than importing a DOM-rendering function — this app has no existing
 * convention for unit-testing that view's DOM output directly (see
 * this session's own prior investigation), so this test proves the
 * exact DATA the view consumes is correctly grouped/ordered, which is
 * the part of the claim that can regress silently. If
 * `renderUnitsOrParts()`'s own grouping expression ever changes, this
 * comment is the pointer to keep this test's reproduction in sync.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as curriculumLinkingService from '../../js/services/curriculumLinkingService.js';
import * as learningRecordService from '../../js/services/learningRecordService.js';
import * as learningRecordTeacherService from '../../js/services/learningRecordTeacherService.js';

/** Reproduces ui/views/LearningManagementView.js's own top-level Part-grouping order derivation exactly — see this file's own header comment for why this isn't imported directly. */
function distinctPartNamesInDisplayOrder(subject) {
  return [...new Set(subject.units.map((unit) => unit.partName).filter(Boolean))];
}

/**
 * A Curriculum Index shaped exactly like a real Grade 6/7 Science
 * curriculum split by term textbook — three Parts, two Units each,
 * authored in the natural order a teacher actually would (all of Term
 * 1's units, then all of Term 2's, then all of Term 3's) — the same
 * order services/curriculumIndexSession.js's own addUnit() naturally
 * produces when a teacher works through Parts in sequence.
 */
function threeTermCurriculumIndex() {
  const term1 = { id: 'part-term-1', name: 'Term 1' };
  const term2 = { id: 'part-term-2', name: 'Term 2' };
  const term3 = { id: 'part-term-3', name: 'Term 3' };
  return {
    id: 'curr-index-3-term',
    status: 'units_confirmed',
    curriculum: { name: 'State Board Science', board: 'State Board', grade: '6', subject: 'Science', subjectId: 'science' },
    parts: [term1, term2, term3],
    units: [
      { id: 'ci-unit-t1-1', number: 1, title: 'Food', printedPage: 1, partId: term1.id },
      { id: 'ci-unit-t1-2', number: 2, title: 'Components of Food', printedPage: 10, partId: term1.id },
      { id: 'ci-unit-t2-1', number: 1, title: 'Fibre to Fabric', printedPage: 1, partId: term2.id },
      { id: 'ci-unit-t2-2', number: 2, title: 'Sorting Materials', printedPage: 12, partId: term2.id },
      { id: 'ci-unit-t3-1', number: 1, title: 'Electric Current', printedPage: 1, partId: term3.id },
      { id: 'ci-unit-t3-2', number: 2, title: 'Light', printedPage: 15, partId: term3.id },
    ],
  };
}

/** A Grade 8-style curriculum: a single "General" Part, matching how a Curriculum Index with no real subdivisions already looks today (unchanged by this decision). */
function singleTextbookCurriculumIndex() {
  const general = { id: 'part-general', name: 'General' };
  return {
    id: 'curr-index-grade-8',
    status: 'units_confirmed',
    curriculum: { name: 'State Board Science', board: 'State Board', grade: '8', subject: 'Science', subjectId: 'science' },
    parts: [general],
    units: [
      { id: 'ci-unit-g8-1', number: 1, title: 'Crop Production and Management', printedPage: 1, partId: general.id },
      { id: 'ci-unit-g8-2', number: 2, title: 'Microorganisms', printedPage: 14, partId: general.id },
      { id: 'ci-unit-g8-3', number: 3, title: 'Synthetic Fibres and Plastics', printedPage: 30, partId: general.id },
    ],
  };
}

function ownedClassroom(id) {
  return createClassroom({ id, schoolName: 'Test School', gradeSection: `Grade ${id}` });
}

// ---------------------------------------------------------------------
// Item 1/2 — multi-Part ("Term") curriculum assigns and groups correctly
// ---------------------------------------------------------------------

test('createSubjectWithCurriculum: a 3-term curriculum produces 6 units, each carrying its own term as partName, title and printedPage-derived number intact', () => {
  const classroom = ownedClassroom('c-multi-term');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', threeTermCurriculumIndex());

  assert.equal(subject.units.length, 6);
  assert.equal(subject.linkedCurriculumIndexId, 'curr-index-3-term');

  const byLinkedId = Object.fromEntries(subject.units.map((u) => [u.linkedCurriculumUnitId, u]));
  assert.equal(byLinkedId['ci-unit-t1-1'].partName, 'Term 1');
  assert.equal(byLinkedId['ci-unit-t1-1'].title, 'Food');
  assert.equal(byLinkedId['ci-unit-t1-1'].number, 1);
  assert.equal(byLinkedId['ci-unit-t2-1'].partName, 'Term 2');
  assert.equal(byLinkedId['ci-unit-t3-2'].partName, 'Term 3');
  assert.equal(byLinkedId['ci-unit-t3-2'].title, 'Light');
});

test('Learning Management grouping: Term 1 -> Term 2 -> Term 3 render in that exact intended order, each showing its own 2 units, via the existing first-occurrence mechanism — no new ordering field needed', () => {
  const classroom = ownedClassroom('c-multi-term-order');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', threeTermCurriculumIndex());

  const partOrder = distinctPartNamesInDisplayOrder(subject);
  assert.deepEqual(partOrder, ['Term 1', 'Term 2', 'Term 3']);

  partOrder.forEach((partName) => {
    const unitsInThisPart = subject.units.filter((u) => u.partName === partName);
    assert.equal(unitsInThisPart.length, 2, `${partName} should show exactly its own 2 units`);
  });

  // Cross-check: "Term 1" -> Unit 1 and "Term 2" -> Unit 1 are genuinely
  // distinct records (per the locked decision's own worked example),
  // never confused with each other despite sharing the same in-part
  // unit number.
  const term1Unit1 = subject.units.find((u) => u.partName === 'Term 1' && u.number === 1);
  const term2Unit1 = subject.units.find((u) => u.partName === 'Term 2' && u.number === 1);
  assert.notEqual(term1Unit1.id, term2Unit1.id);
  assert.notEqual(term1Unit1.title, term2Unit1.title);
});

// ---------------------------------------------------------------------
// Item 3 — single/no-Part curriculum (Grade 8) stays a flat list
// ---------------------------------------------------------------------

test('createSubjectWithCurriculum: a single-Part curriculum (Grade 8 style) produces units with NO partName at all — flat list, unaffected by the term decision', () => {
  const classroom = ownedClassroom('c-grade-8');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', singleTextbookCurriculumIndex());

  assert.equal(subject.units.length, 3);
  assert.ok(subject.units.every((u) => !('partName' in u)), 'a single-Part curriculum must omit partName entirely, not set it to a falsy value');

  const partOrder = distinctPartNamesInDisplayOrder(subject);
  assert.deepEqual(partOrder, [], 'no Part grouping should ever be shown for a flat, single-textbook curriculum');
});

// ---------------------------------------------------------------------
// Item 4 — stable Unit IDs; Lesson Plan / Learning Hub pack references survive
// ---------------------------------------------------------------------

test('Unit ids assigned from a multi-term curriculum are stable across rename operations — the same identity Lesson.curriculumUnitId/getUnitById() depend on', () => {
  const classroom = ownedClassroom('c-stability');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', threeTermCurriculumIndex());
  const term2Unit2 = subject.units.find((u) => u.partName === 'Term 2' && u.number === 2);
  const originalId = term2Unit2.id;

  // Simulates a Lesson Plan / Timetable "Assign Unit" reference already
  // holding this id, exactly the way models/Lesson.js's own
  // curriculumUnitId does (see that model's header comment: "resolved
  // live against the Curriculum domain at display time").
  const resolvedBeforeRename = learningRecordService.getUnitById(classroom, originalId);
  assert.equal(resolvedBeforeRename.title, 'Sorting Materials');

  learningRecordTeacherService.renameUnit(classroom, originalId, 'Sorting Materials and Objects');
  learningRecordTeacherService.renameSubject(classroom, subject.id, 'Science (Renamed)');

  const resolvedAfterRename = learningRecordService.getUnitById(classroom, originalId);
  assert.equal(resolvedAfterRename.id, originalId, 'id must never change from a rename');
  assert.equal(resolvedAfterRename.title, 'Sorting Materials and Objects');
  assert.equal(resolvedAfterRename.partName, 'Term 2', 'partName/term membership must survive an unrelated rename');
  assert.equal(resolvedAfterRename.linkedCurriculumUnitId, 'ci-unit-t2-2', 'the link back to the source curriculum unit must survive too');

  // The sibling units (including the other terms') are untouched.
  assert.equal(subject.units.length, 6);
  assert.ok(subject.units.some((u) => u.partName === 'Term 1' && u.title === 'Food'));
  assert.ok(subject.units.some((u) => u.partName === 'Term 3' && u.title === 'Light'));
});

test('a Learning Hub pack association on a Term-scoped unit survives sibling operations untouched — no interference from the term/Part grouping', () => {
  const classroom = ownedClassroom('c-pack-safety');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', threeTermCurriculumIndex());
  const term1Unit1 = subject.units.find((u) => u.partName === 'Term 1' && u.number === 1);
  term1Unit1.learningHubPack = { packId: 'pack-food-basics', title: 'Food Basics' };

  // Rename a DIFFERENT unit in a DIFFERENT term, and add a brand new unit.
  const term3Unit1 = subject.units.find((u) => u.partName === 'Term 3' && u.number === 1);
  learningRecordTeacherService.renameUnit(classroom, term3Unit1.id, 'Electric Current and Circuits');
  learningRecordTeacherService.createUnit(classroom, subject.id, { title: 'Extra Term 3 Unit', partName: 'Term 3' });

  const stillThere = learningRecordService.getUnitById(classroom, term1Unit1.id);
  assert.deepEqual(stillThere.learningHubPack, { packId: 'pack-food-basics', title: 'Food Basics' });
  assert.equal(stillThere.partName, 'Term 1');
});

// ---------------------------------------------------------------------
// Item 5 — Part ordering under the existing mechanism, including the one
// real (pre-existing, general, not term-specific) limitation found.
// ---------------------------------------------------------------------

test('Part order is determined by first-unit-occurrence in the classroom Subject.units array, which matches curriculum authoring order for the natural term-by-term workflow', () => {
  const classroom = ownedClassroom('c-order-mechanism');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', threeTermCurriculumIndex());
  // buildUnitsFromCurriculumIndex() is a straight .map() over
  // curriculumIndex.units in source order (see
  // services/curriculumLinkingService.js) — so Subject.units already
  // preserves exactly the order the Curriculum Index's own units array
  // was in, term-contiguous, since that's how the fixture (and a real
  // teacher working Part-by-Part) naturally produces it.
  assert.deepEqual(
    subject.units.map((u) => u.linkedCurriculumUnitId),
    ['ci-unit-t1-1', 'ci-unit-t1-2', 'ci-unit-t2-1', 'ci-unit-t2-2', 'ci-unit-t3-1', 'ci-unit-t3-2']
  );
  assert.deepEqual(distinctPartNamesInDisplayOrder(subject), ['Term 1', 'Term 2', 'Term 3']);
});

test('DOCUMENTED, PRE-EXISTING, NOT term-specific: if a Curriculum Index\'s own units[] array is non-contiguous by Part (a teacher returns to an earlier Part after already populating a later one), Part display order still reflects first-occurrence correctly — grouping is robust even though services/curriculumIndexSession.js\'s own addUnit() does not itself keep units[] Part-contiguous (unlike services/curriculumReviewService.js\'s moveDraftUnitToPart(), which does). Not a term/Part-naming-specific gap, and not something this decision introduces or requires fixing.', () => {
  const outOfOrderIndex = threeTermCurriculumIndex();
  // Simulate the edge case directly: a unit for Term 1 added AFTER
  // Term 2/3 already have units, landing at the end of the array —
  // exactly what services/curriculumIndexSession.js's own addUnit()
  // (`index.units.push(unit)`, no Part-contiguous insertion) would do.
  outOfOrderIndex.units.push({ id: 'ci-unit-t1-3-late', number: 3, title: 'Late-Added Term 1 Unit', printedPage: 20, partId: 'part-term-1' });

  const classroom = ownedClassroom('c-out-of-order');
  const subject = curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', outOfOrderIndex);

  // Part-level display order is still correct...
  assert.deepEqual(distinctPartNamesInDisplayOrder(subject), ['Term 1', 'Term 2', 'Term 3']);
  // ...and the late-added unit still shows up correctly grouped under Term 1.
  const term1Units = subject.units.filter((u) => u.partName === 'Term 1');
  assert.equal(term1Units.length, 3);
  assert.ok(term1Units.some((u) => u.title === 'Late-Added Term 1 Unit'));
});

// ---------------------------------------------------------------------
// Sanity: findAvailableCurriculumIndexesForSubject / isCurriculumIndexLinked
// are unaffected by whether a curriculum has 1 Part or many.
// ---------------------------------------------------------------------

test('isCurriculumIndexLinked / findAvailableCurriculumIndexesForSubject behave identically for single-Part and multi-Part curricula — Part count is invisible to linking logic', () => {
  const classroom = ownedClassroom('c-linking-sanity');
  const threeTermIndex = threeTermCurriculumIndex();
  const singleIndex = singleTextbookCurriculumIndex();

  assert.equal(curriculumLinkingService.isCurriculumIndexLinked(classroom, threeTermIndex.id), false);
  curriculumLinkingService.createSubjectWithCurriculum(classroom, 'Science', 'science', threeTermIndex);
  assert.equal(curriculumLinkingService.isCurriculumIndexLinked(classroom, threeTermIndex.id), true);
  assert.equal(curriculumLinkingService.isCurriculumIndexLinked(classroom, singleIndex.id), false);

  const available = curriculumLinkingService.findAvailableCurriculumIndexesForSubject(classroom, [threeTermIndex, singleIndex], 'science');
  assert.deepEqual(available.map((i) => i.id), [singleIndex.id], 'the already-linked 3-term index is correctly excluded; the unrelated single-textbook one is still offered');
});
