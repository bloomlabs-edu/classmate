/**
 * tests/services/learningHubLaunchUrlService.test.js
 *
 * Real, executed unit tests against
 * services/learningHubLaunchUrlService.js's own pure, exported
 * functions — resolveLearningHubConceptBucketUrl() (the ClassMate ->
 * Learning Hub Concept identity bridge, new this milestone) and
 * buildLearningHubLaunchUrl() (pre-existing, moved here unchanged —
 * see that file's own header comment for why). No DOM, no Firebase,
 * no mocking of anything — this module has zero imports.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLearningHubConceptBucketUrl, buildLearningHubLaunchUrl } from '../../js/services/learningHubLaunchUrlService.js';

// ---------------------------------------------------------------------
// resolveLearningHubConceptBucketUrl() — mapped LearningConcept
// ---------------------------------------------------------------------

test('mapped LearningConcept: produces the canonical Learning Hub Concept Bucket URL via the existing ?entry=concept:<id> mechanism', () => {
  const concept = { id: 'local-concept-1', title: 'Weather or Climate?', learningHubConcept: { conceptId: 'weather', title: 'Weather or Climate?' } };
  const url = resolveLearningHubConceptBucketUrl(concept);
  assert.equal(url, 'https://learning-hub-b2586.web.app/?entry=concept%3Aweather');
});

test('mapped LearningConcept: uses learningHubConcept.conceptId exactly as stored — never derived, parsed, or transformed', () => {
  // A conceptId that would look different if it were ever lowercased,
  // slugified, or trimmed — proves the value is passed through
  // byte-for-byte, not normalized.
  const concept = { id: 'local-concept-2', title: 'Anything', learningHubConcept: { conceptId: 'Mixed-Case_ID.42', title: 'Anything' } };
  const url = resolveLearningHubConceptBucketUrl(concept);
  assert.equal(url, `https://learning-hub-b2586.web.app/?entry=${encodeURIComponent('concept:Mixed-Case_ID.42')}`);
});

test('mapped LearningConcept: never derives the destination from the ClassMate-local concept.id or concept.title', () => {
  const concept = { id: 'should-never-appear', title: 'Should also never appear', learningHubConcept: { conceptId: 'real-lh-id', title: 'Cached display title, also never used for identity' } };
  const url = resolveLearningHubConceptBucketUrl(concept);
  assert.ok(!url.includes('should-never-appear'));
  assert.ok(!url.includes(encodeURIComponent('Should also never appear')));
  assert.ok(!url.includes(encodeURIComponent('Cached display title')));
  assert.equal(url, 'https://learning-hub-b2586.web.app/?entry=concept%3Areal-lh-id');
});

// ---------------------------------------------------------------------
// resolveLearningHubConceptBucketUrl() — unmapped / invalid LearningConcept
// ---------------------------------------------------------------------

test('unmapped LearningConcept: learningHubConcept is null -> returns null, never a malformed URL', () => {
  const concept = { id: 'c1', title: 'No mapping yet', learningHubConcept: null };
  assert.equal(resolveLearningHubConceptBucketUrl(concept), null);
});

test('unmapped LearningConcept: learningHubConcept field missing entirely (pre-migration concept) -> returns null', () => {
  const concept = { id: 'c2', title: 'Created before this field existed' };
  assert.equal(resolveLearningHubConceptBucketUrl(concept), null);
});

test('invalid mapping: learningHubConcept.conceptId is an empty string -> returns null', () => {
  const concept = { id: 'c3', title: 'x', learningHubConcept: { conceptId: '', title: 'x' } };
  assert.equal(resolveLearningHubConceptBucketUrl(concept), null);
});

test('invalid mapping: learningHubConcept.conceptId is whitespace only -> returns null', () => {
  const concept = { id: 'c4', title: 'x', learningHubConcept: { conceptId: '   ', title: 'x' } };
  assert.equal(resolveLearningHubConceptBucketUrl(concept), null);
});

test('invalid mapping: learningHubConcept.conceptId is not a string (e.g. malformed data) -> returns null, not a broken URL', () => {
  const concept = { id: 'c5', title: 'x', learningHubConcept: { conceptId: 12345, title: 'x' } };
  assert.equal(resolveLearningHubConceptBucketUrl(concept), null);
});

test('invalid input: concept itself is null/undefined -> returns null rather than throwing', () => {
  assert.equal(resolveLearningHubConceptBucketUrl(null), null);
  assert.equal(resolveLearningHubConceptBucketUrl(undefined), null);
});

// ---------------------------------------------------------------------
// buildLearningHubLaunchUrl() — unrelated, pre-existing behavior must
// remain unchanged by this milestone's extraction/move.
// ---------------------------------------------------------------------

test('buildLearningHubLaunchUrl: unchanged two-argument shape (experience type + id)', () => {
  assert.equal(buildLearningHubLaunchUrl('lesson', 'weather'), 'https://learning-hub-b2586.web.app/?entry=lesson%3Aweather');
  assert.equal(buildLearningHubLaunchUrl('pack', 'weather-climate-samacheer-g8'), `https://learning-hub-b2586.web.app/?entry=${encodeURIComponent('pack:weather-climate-samacheer-g8')}`);
});

test('buildLearningHubLaunchUrl: unchanged backward-compatible single-argument (legacy missionId-only) shape', () => {
  assert.equal(buildLearningHubLaunchUrl('legacy-mission-id'), `https://learning-hub-b2586.web.app/?entry=${encodeURIComponent('mission:legacy-mission-id')}`);
});

test('buildLearningHubLaunchUrl: resolveLearningHubConceptBucketUrl is a thin wrapper over the exact same mechanism, not a second implementation', () => {
  const conceptId = 'photosynthesis';
  assert.equal(
    resolveLearningHubConceptBucketUrl({ learningHubConcept: { conceptId } }),
    buildLearningHubLaunchUrl('concept', conceptId)
  );
});
