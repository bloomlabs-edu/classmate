import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getConceptIndex,
  getPreviousConcept,
  getNextConcept,
  isInteractiveElement,
  resolveSwipeDirection,
} from '../../js/services/conceptNavigationService.js';

function makeUnit(conceptIds) {
  return { id: 'unit-1', concepts: conceptIds.map((id) => ({ id, title: `Concept ${id}` })) };
}

// ---------------------------------------------------------------------
// Ordering / boundaries (test list items 1-4, 7)
// ---------------------------------------------------------------------

test('Concept with both a previous and a next -> both are resolvable', () => {
  const unit = makeUnit(['a', 'b', 'c']);
  assert.equal(getPreviousConcept(unit, 'b').id, 'a');
  assert.equal(getNextConcept(unit, 'b').id, 'c');
});

test('first Concept -> previous is null, next is available', () => {
  const unit = makeUnit(['a', 'b', 'c']);
  assert.equal(getPreviousConcept(unit, 'a'), null);
  assert.equal(getNextConcept(unit, 'a').id, 'b');
});

test('last Concept -> previous is available, next is null', () => {
  const unit = makeUnit(['a', 'b', 'c']);
  assert.equal(getPreviousConcept(unit, 'c').id, 'b');
  assert.equal(getNextConcept(unit, 'c'), null);
});

test('single-Concept unit -> both previous and next are null', () => {
  const unit = makeUnit(['only']);
  assert.equal(getPreviousConcept(unit, 'only'), null);
  assert.equal(getNextConcept(unit, 'only'), null);
});

test('ordering follows unit.concepts array order exactly — the same array/order ui/views/LearningManagementView.js\'s own Concepts list renders from, not a re-sort or invented ordering', () => {
  // Deliberately NOT alphabetical/id-sorted, to prove no re-sorting happens anywhere in this module.
  const unit = makeUnit(['zzz-last-alphabetically', 'aaa-first-alphabetically', 'mmm-middle']);
  assert.equal(getNextConcept(unit, 'zzz-last-alphabetically').id, 'aaa-first-alphabetically');
  assert.equal(getPreviousConcept(unit, 'mmm-middle').id, 'aaa-first-alphabetically');
});

test('a conceptId not present in this unit at all (e.g. already navigated away, or belongs to a different unit/classroom) -> both previous and next are null, never a crash or a guess', () => {
  const unit = makeUnit(['a', 'b']);
  assert.equal(getConceptIndex(unit, 'not-in-this-unit'), -1);
  assert.equal(getPreviousConcept(unit, 'not-in-this-unit'), null);
  assert.equal(getNextConcept(unit, 'not-in-this-unit'), null);
});

// ---------------------------------------------------------------------
// Classroom/unit scope (test list item 8) — provable by construction:
// these functions only ever receive one `unit` object and never see a
// classroom or any other unit, so there is no code path by which they
// could resolve into a different classroom's (or a different unit's)
// Concept.
// ---------------------------------------------------------------------

test('navigation never crosses into a different unit\'s concepts, even if two units share a concept id', () => {
  const unitOne = makeUnit(['shared-id', 'b']);
  const unitTwo = makeUnit(['x', 'shared-id', 'z']);
  // Same conceptId, but resolving against unitTwo only ever looks at unitTwo's own array.
  assert.equal(getPreviousConcept(unitTwo, 'shared-id').id, 'x');
  assert.equal(getNextConcept(unitTwo, 'shared-id').id, 'z');
  // unitOne's own neighbors for the same id are entirely different, proving no cross-unit lookup occurred.
  assert.equal(getPreviousConcept(unitOne, 'shared-id'), null);
  assert.equal(getNextConcept(unitOne, 'shared-id').id, 'b');
});

// ---------------------------------------------------------------------
// Keyboard focus guard (part of test list item 10)
// ---------------------------------------------------------------------

test('isInteractiveElement is true for input/textarea/select/button and contenteditable, false otherwise', () => {
  assert.equal(isInteractiveElement({ tagName: 'INPUT' }), true);
  assert.equal(isInteractiveElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isInteractiveElement({ tagName: 'SELECT' }), true);
  assert.equal(isInteractiveElement({ tagName: 'BUTTON' }), true);
  assert.equal(isInteractiveElement({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isInteractiveElement({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(isInteractiveElement({ tagName: 'P' }), false);
  assert.equal(isInteractiveElement(null), false);
});

// ---------------------------------------------------------------------
// Swipe gesture recognition (test list item 11)
// ---------------------------------------------------------------------

test('a clear leftward swipe resolves to "next"', () => {
  assert.equal(resolveSwipeDirection(-120, 0), 'next');
});

test('a clear rightward swipe resolves to "previous"', () => {
  assert.equal(resolveSwipeDirection(120, 0), 'previous');
});

test('a small horizontal movement below the distance threshold does not navigate', () => {
  assert.equal(resolveSwipeDirection(15, 0), null);
  assert.equal(resolveSwipeDirection(-15, 0), null);
});

test('a predominantly vertical movement (an ordinary scroll) does not navigate, even past the raw distance threshold', () => {
  assert.equal(resolveSwipeDirection(70, 200), null);
  assert.equal(resolveSwipeDirection(-70, -200), null);
});

test('a diagonal movement where horizontal still clearly dominates vertical does navigate', () => {
  assert.equal(resolveSwipeDirection(-100, 10), 'next');
});
