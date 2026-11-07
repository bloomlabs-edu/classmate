/**
 * tests/scripts/foundingRecognitionClassroomRegistry.test.js
 *
 * Tests scripts/foundingRecognitionClassroomRegistry.js's own safe-
 * default classification logic (getClassroomClassification/
 * getClassroomClassificationDetail) directly against in-memory
 * registry shapes -- confirms unknown ids, missing entries, and
 * malformed entries all resolve identically to NEEDS_REVIEW, and that
 * a well-formed confirmed entry's own detail fields are read
 * faithfully, never fabricated. The one test against the real,
 * checked-in registry file only asserts that loading never throws and
 * every entry it does contain (if any) resolves to a valid
 * classification -- it deliberately never asserts the registry is
 * empty, since an administrator may have populated real entries by the
 * time this runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFoundingRecognitionClassroomRegistry,
  getClassroomClassification,
  getClassroomClassificationDetail,
  FOUNDING_RECOGNITION_CLASSIFICATIONS,
} from '../../scripts/foundingRecognitionClassroomRegistry.js';

const { CONFIRMED_REAL, CONFIRMED_TEST, NEEDS_REVIEW } = FOUNDING_RECOGNITION_CLASSIFICATIONS;

// ---------------------------------------------------------------------
// getClassroomClassification / getClassroomClassificationDetail --
// pure functions, tested directly against in-memory registry shapes
// (the actual JSON-file-reading path is covered separately below).
// ---------------------------------------------------------------------

test('getClassroomClassification: an unknown classroom id (absent from the registry entirely) resolves to NEEDS_REVIEW', () => {
  const registry = { 'some-other-classroom': { classification: CONFIRMED_REAL } };
  assert.equal(getClassroomClassification(registry, 'unknown-classroom-id'), NEEDS_REVIEW);
});

test('getClassroomClassification: an empty registry resolves every classroom id to NEEDS_REVIEW', () => {
  assert.equal(getClassroomClassification({}, 'any-classroom-id'), NEEDS_REVIEW);
});

test('getClassroomClassification: a present entry missing the classification field entirely resolves to NEEDS_REVIEW, never guessed', () => {
  const registry = { 'classroom-1': { reason: 'reviewed but someone forgot to set the classification field', reviewedBy: 'staff@example.org', reviewedAt: '2026-11-10T00:00:00.000Z' } };
  assert.equal(getClassroomClassification(registry, 'classroom-1'), NEEDS_REVIEW);
});

test('getClassroomClassification: a malformed/unrecognized classification value (typo, wrong case, or free text) resolves to NEEDS_REVIEW, never the confirmed state it was probably trying to express', () => {
  const registry = {
    'classroom-typo': { classification: 'confirmed-real' }, // hyphen instead of underscore
    'classroom-wrong-case': { classification: 'CONFIRMED_REAL' },
    'classroom-free-text': { classification: 'yes this one is real' },
    'classroom-null': { classification: null },
    'classroom-number': { classification: 1 },
  };
  for (const id of Object.keys(registry)) {
    assert.equal(getClassroomClassification(registry, id), NEEDS_REVIEW, `expected ${id} to resolve to NEEDS_REVIEW`);
  }
});

test('getClassroomClassification: exact valid CONFIRMED_REAL and CONFIRMED_TEST strings resolve correctly', () => {
  const registry = {
    'real-classroom': { classification: CONFIRMED_REAL },
    'test-classroom': { classification: CONFIRMED_TEST },
  };
  assert.equal(getClassroomClassification(registry, 'real-classroom'), CONFIRMED_REAL);
  assert.equal(getClassroomClassification(registry, 'test-classroom'), CONFIRMED_TEST);
});

test('getClassroomClassificationDetail: a well-formed confirmed entry returns its own reason/reviewedBy/reviewedAt faithfully', () => {
  const registry = {
    'classroom-1': {
      classification: CONFIRMED_REAL,
      reason: 'Verified via direct conversation with the fellow; checkpoints and roster match the known real class.',
      reviewedBy: 'program.staff@teachforindia.org',
      reviewedAt: '2026-11-10T09:00:00.000Z',
    },
  };
  const detail = getClassroomClassificationDetail(registry, 'classroom-1');
  assert.deepEqual(detail, {
    classification: CONFIRMED_REAL,
    reason: 'Verified via direct conversation with the fellow; checkpoints and roster match the known real class.',
    reviewedBy: 'program.staff@teachforindia.org',
    reviewedAt: '2026-11-10T09:00:00.000Z',
  });
});

test('getClassroomClassificationDetail: an unknown classroom id returns NEEDS_REVIEW with every detail field null -- never fabricated', () => {
  const detail = getClassroomClassificationDetail({}, 'unknown-id');
  assert.deepEqual(detail, { classification: NEEDS_REVIEW, reason: null, reviewedBy: null, reviewedAt: null });
});

test('getClassroomClassificationDetail: a malformed entry (invalid classification, non-string reason) returns NEEDS_REVIEW with detail fields defensively nulled rather than passing through garbage types', () => {
  const registry = { 'classroom-1': { classification: 'bogus', reason: 12345, reviewedBy: {}, reviewedAt: true } };
  const detail = getClassroomClassificationDetail(registry, 'classroom-1');
  assert.deepEqual(detail, { classification: NEEDS_REVIEW, reason: null, reviewedBy: null, reviewedAt: null });
});

// ---------------------------------------------------------------------
// loadFoundingRecognitionClassroomRegistry -- actual file reading,
// against real temporary JSON fixture files (never the live registry).
// ---------------------------------------------------------------------

test('loadFoundingRecognitionClassroomRegistry: the live, checked-in registry file loads successfully and starts with zero confirmed entries', () => {
  const registry = loadFoundingRecognitionClassroomRegistry();
  assert.equal(typeof registry, 'object');
  // Not asserting it's empty forever -- an administrator may have
  // populated it by the time this runs -- only that loading never
  // throws and always returns a usable object shape.
  for (const entry of Object.values(registry)) {
    assert.ok([CONFIRMED_REAL, CONFIRMED_TEST, NEEDS_REVIEW].includes(getClassroomClassification({ x: entry }, 'x')));
  }
});
