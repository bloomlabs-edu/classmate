/**
 * tests/services/unitPageRangeService.test.js
 *
 * services/unitPageRangeService.js's getDerivedPageRange() — derives a
 * Curriculum Index Unit's { startPage, endPage } on demand from
 * `index.units`' own array order, since `endPage` is never persisted
 * (see that file's header comment for why).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDerivedPageRange } from '../../js/services/unitPageRangeService.js';

function unit(id, printedPage) {
  return { id, printedPage };
}

test('a unit followed by another unit derives endPage as the next unit\'s printedPage minus one', () => {
  const index = { units: [unit('u1', 10), unit('u2', 25)] };
  const result = getDerivedPageRange(index, 'u1');
  assert.deepEqual(result, { startPage: 10, endPage: 24 });
});

test('the last unit in array order returns endPage: null inside the result object, not a fabricated number and not a null result', () => {
  const index = { units: [unit('u1', 10), unit('u2', 25)] };
  const result = getDerivedPageRange(index, 'u2');
  assert.notEqual(result, null);
  assert.deepEqual(result, { startPage: 25, endPage: null });
});

test('a unit with no printedPage of its own returns null overall, even when a next unit exists', () => {
  const index = { units: [unit('u1', null), unit('u2', 25)] };
  const result = getDerivedPageRange(index, 'u1');
  assert.equal(result, null);
});

test('a unit with an undefined printedPage of its own also returns null overall', () => {
  const index = { units: [{ id: 'u1' }, unit('u2', 25)] };
  const result = getDerivedPageRange(index, 'u1');
  assert.equal(result, null);
});

test('a unitId not present in index.units returns null', () => {
  const index = { units: [unit('u1', 10), unit('u2', 25)] };
  const result = getDerivedPageRange(index, 'does-not-exist');
  assert.equal(result, null);
});
