/**
 * tests/config/firestoreIndexes.test.js
 *
 * Validates the ACTUAL, PARSED content of firestore.indexes.json and
 * firebase.json — real JSON.parse() + structural assertions against
 * the object these files produce, not a text/regex search over their
 * source. This is CODE-INSPECTED validation of static configuration:
 * it proves the files are well-formed and contain exactly the two
 * composite indexes services/programmeSessionRepository.js's own
 * listSessionsForProgramme()/listSessionsForProgrammeInRange() require
 * (see this project's own Phase 1.5 Live-Readiness Audit §2).
 *
 * It CANNOT and does NOT claim to prove that Firestore will actually
 * accept these index definitions, that they are sufficient for every
 * possible query shape, or that a real deployment would succeed —
 * that would require a live Firebase project or the Firestore
 * emulator, neither available in this sandbox. See this project's own
 * Phase 1.6 Hardening implementation report for the explicit
 * UNIT TESTED / CODE-INSPECTED / LIVE FIRESTORE VERIFIED distinction
 * this file's own tests fall under (CODE-INSPECTED).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

function readJson(relativePath) {
  const raw = readFileSync(join(repoRoot, relativePath), 'utf8');
  return JSON.parse(raw);
}

test('firestore.indexes.json: is valid, parseable JSON', () => {
  assert.doesNotThrow(() => readJson('firestore.indexes.json'));
});

test('firestore.indexes.json: has the top-level shape Firestore\'s index schema requires', () => {
  const data = readJson('firestore.indexes.json');
  assert.ok(Array.isArray(data.indexes), '"indexes" must be an array');
  assert.ok(Array.isArray(data.fieldOverrides), '"fieldOverrides" must be an array');
});

test('firestore.indexes.json: every index entry has the required fields with valid values', () => {
  const data = readJson('firestore.indexes.json');
  for (const index of data.indexes) {
    assert.ok(typeof index.collectionGroup === 'string' && index.collectionGroup.length > 0);
    assert.ok(['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope), `queryScope "${index.queryScope}" must be a real Firestore query scope`);
    assert.ok(Array.isArray(index.fields) && index.fields.length >= 2, 'a composite index must have at least two fields');
    for (const field of index.fields) {
      assert.ok(typeof field.fieldPath === 'string' && field.fieldPath.length > 0);
      assert.ok(['ASCENDING', 'DESCENDING'].includes(field.order), `order "${field.order}" must be a real Firestore sort order`);
    }
  }
});

test('firestore.indexes.json: contains exactly the composite index required by listSessionsForProgramme() — (programmeId ASC, date DESC)', () => {
  const data = readJson('firestore.indexes.json');
  const match = data.indexes.find(
    (index) =>
      index.collectionGroup === 'programmeSessions' &&
      index.fields.length === 2 &&
      index.fields[0].fieldPath === 'programmeId' &&
      index.fields[0].order === 'ASCENDING' &&
      index.fields[1].fieldPath === 'date' &&
      index.fields[1].order === 'DESCENDING'
  );
  assert.ok(match, 'expected a (programmeId ASC, date DESC) composite index on programmeSessions');
});

test('firestore.indexes.json: contains exactly the composite index required by listSessionsForProgrammeInRange() — (programmeId ASC, date ASC)', () => {
  const data = readJson('firestore.indexes.json');
  const match = data.indexes.find(
    (index) =>
      index.collectionGroup === 'programmeSessions' &&
      index.fields.length === 2 &&
      index.fields[0].fieldPath === 'programmeId' &&
      index.fields[0].order === 'ASCENDING' &&
      index.fields[1].fieldPath === 'date' &&
      index.fields[1].order === 'ASCENDING'
  );
  assert.ok(match, 'expected a (programmeId ASC, date ASC) composite index on programmeSessions');
});

test('firestore.indexes.json: contains no duplicate index definitions', () => {
  const data = readJson('firestore.indexes.json');
  const keys = data.indexes.map((index) =>
    JSON.stringify([index.collectionGroup, index.queryScope, index.fields.map((f) => [f.fieldPath, f.order])])
  );
  const uniqueKeys = new Set(keys);
  assert.equal(uniqueKeys.size, keys.length, 'every index definition must be unique — no duplicates');
});

test('firestore.indexes.json: contains no speculative indexes beyond the two required ones', () => {
  const data = readJson('firestore.indexes.json');
  assert.equal(data.indexes.length, 2, 'exactly two composite indexes are required — no additional, speculative entries should exist');
});

test('firebase.json: is valid, parseable JSON, and references both firestore.rules and firestore.indexes.json', () => {
  const data = readJson('firebase.json');
  assert.equal(data.firestore.rules, 'firestore.rules');
  assert.equal(data.firestore.indexes, 'firestore.indexes.json');
});

test('firebase.json: hosting configuration is untouched by this change', () => {
  const data = readJson('firebase.json');
  assert.equal(data.hosting.public, '.');
  assert.deepEqual(data.hosting.ignore, ['firebase.json', '**/.*', '**/node_modules/**', 'tests/**', 'docs/**', 'firebase-rules-verification/**', 'CHANGELOG.md', 'CONTRIBUTING.md', 'README.md']);
});
