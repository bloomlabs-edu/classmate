/**
 * tests/config/canonicalSubjectsConfig.test.js
 *
 * config/canonicalSubjectsConfig.js's own CANONICAL_SUBJECTS registry
 * — confirms the array and every entry stay frozen (the "only
 * sanctioned way to get a shared subjectId across screens" invariant
 * this file's own header comment describes depends on nobody ever
 * mutating an entry after the fact), and that each of the newer
 * additions (Tamil / Optional Language / Accounts / Physical
 * Education) is present and resolvable via
 * services/subjectIdentityService.js's own getCanonicalSubjects()/
 * getCanonicalSubjectById(), the same as every pre-existing entry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_SUBJECTS } from '../../js/config/canonicalSubjectsConfig.js';
import { getCanonicalSubjects, getCanonicalSubjectById } from '../../js/services/subjectIdentityService.js';

test('CANONICAL_SUBJECTS: the array and each entry are frozen', () => {
  assert.ok(Object.isFrozen(CANONICAL_SUBJECTS));
  CANONICAL_SUBJECTS.forEach((subject) => assert.ok(Object.isFrozen(subject)));
});

test('CANONICAL_SUBJECTS: pre-existing entries are unchanged', () => {
  assert.deepEqual(
    CANONICAL_SUBJECTS.slice(0, 8).map((s) => s.id),
    ['science', 'mathematics', 'english', 'social_science', 'hindi', 'computer_science', 'environmental_studies', 'art']
  );
});

test('CANONICAL_SUBJECTS / getCanonicalSubjects: Tamil, Optional Language, Accounts, Physical Education are present with the expected {id, title}', () => {
  const expected = [
    ['tamil', 'Tamil'],
    ['optional_language', 'Optional Language'],
    ['accounts', 'Accounts'],
    ['physical_education', 'Physical Education'],
  ];
  const subjects = getCanonicalSubjects();
  expected.forEach(([id, title]) => {
    const entry = subjects.find((s) => s.id === id);
    assert.ok(entry, `expected a canonical subject with id "${id}"`);
    assert.equal(entry.title, title);
  });
});

test('getCanonicalSubjectById: resolves each of the 4 new canonical subjects individually', () => {
  assert.equal(getCanonicalSubjectById('tamil').title, 'Tamil');
  assert.equal(getCanonicalSubjectById('optional_language').title, 'Optional Language');
  assert.equal(getCanonicalSubjectById('accounts').title, 'Accounts');
  assert.equal(getCanonicalSubjectById('physical_education').title, 'Physical Education');
});

test('getCanonicalSubjectById: an unknown id still returns null', () => {
  assert.equal(getCanonicalSubjectById('not_a_real_subject'), null);
});
