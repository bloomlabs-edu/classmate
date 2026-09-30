/**
 * tests/services/guidanceEngine.test.js
 *
 * Covers services/guidanceEngine.js's pure decision logic in isolation
 * — no DOM, no Firestore, matching this project's own convention for
 * testing pure logic separate from its DOM-rendering sibling (see
 * tests/ui/myWorkTaskDisplay.test.js vs. ui/views/MyWorkView.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFlowComplete, resolveNextStep, isLastResolvableStep } from '../../js/services/guidanceEngine.js';

function flowWithSteps(...selectors) {
  return {
    id: 'testFlow',
    version: 1,
    routeName: 'home',
    steps: selectors.map((targetSelector) => ({ targetSelector, title: 't', body: 'b' })),
  };
}

test('isFlowComplete: no saved entry at all is never complete', () => {
  const flow = { id: 'myWork', version: 1 };
  assert.equal(isFlowComplete(flow, {}), false);
  assert.equal(isFlowComplete(flow, null), false);
  assert.equal(isFlowComplete(flow, undefined), false);
});

test('isFlowComplete: saved version below the current config version is not complete', () => {
  const flow = { id: 'myWork', version: 2 };
  assert.equal(isFlowComplete(flow, { myWork: 1 }), false);
});

test('isFlowComplete: saved version equal to or above the current config version is complete', () => {
  const flow = { id: 'myWork', version: 2 };
  assert.equal(isFlowComplete(flow, { myWork: 2 }), true);
  assert.equal(isFlowComplete(flow, { myWork: 3 }), true);
});

test('isFlowComplete: a different flow\'s own entry in the same map never affects this flow', () => {
  const flow = { id: 'myWork', version: 1 };
  assert.equal(isFlowComplete(flow, { someOtherFlow: 5 }), false);
});

test('resolveNextStep: returns the first step whose target is present', () => {
  const flow = flowWithSteps('.a', '.b', '.c');
  const present = new Set(['.b']);
  const result = resolveNextStep(flow, 0, (selector) => present.has(selector));
  assert.deepEqual(result, { index: 1, step: flow.steps[1] });
});

test('resolveNextStep: respects fromIndex, never looking earlier than it', () => {
  const flow = flowWithSteps('.a', '.b');
  const result = resolveNextStep(flow, 1, () => true);
  assert.equal(result.index, 1);
});

test('resolveNextStep: returns null when no remaining step has a present target', () => {
  const flow = flowWithSteps('.a', '.b');
  const result = resolveNextStep(flow, 0, () => false);
  assert.equal(result, null);
});

test('isLastResolvableStep: true when no later step has a present target', () => {
  const flow = flowWithSteps('.a', '.b');
  const present = new Set(['.a']);
  assert.equal(isLastResolvableStep(flow, 0, (selector) => present.has(selector)), true);
});

test('isLastResolvableStep: false when a later step still has a present target', () => {
  const flow = flowWithSteps('.a', '.b', '.c');
  const present = new Set(['.a', '.c']);
  assert.equal(isLastResolvableStep(flow, 0, (selector) => present.has(selector)), false);
});
