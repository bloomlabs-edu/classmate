/**
 * tests/ui/lessonPlanBuilderActivityTeachingIdeasButtonTier.test.js
 *
 * WORK-0025: the Activity-level "Browse Ideas" ("From Teaching Ideas")
 * button inside renderActivitiesSection() used to hand-roll its own
 * `btn btn--secondary lesson-plan-builder__add-activity-button` markup
 * — a different visual tier than the SAME action's own shared, reusable
 * createFromTeachingIdeasButton() helper (already used for the
 * identical action in renderSparkSection(), via the established tonal-
 * blue pill tier — see that helper's own header comment). Corrected to
 * call the shared helper directly, so both call sites can never drift
 * out of visual sync again, by construction, rather than merely by
 * convention.
 *
 * SCOPE NOTE: ui/views/LessonPlanBuilderView.js's own exported
 * renderLessonPlanBuilderView() is a strict, multi-stage guided flow —
 * mounting it far enough to reach the Activities stage with real,
 * valid classroom/curriculum fixtures is disproportionate to this one
 * button-tier fix (the same reasoning already established by this
 * repo's own WORK-0024 test, tests/ui/lessonPlanBuilderObjectivesAutoGrow.test.js,
 * for the same view). Neither renderActivitiesSection() nor
 * createFromTeachingIdeasButton() is exported, so this test verifies
 * the fix directly from source text — pinning both the call site and
 * the absence of the old hand-rolled markup — rather than a full page
 * mount.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'js/ui/views/LessonPlanBuilderView.js'), 'utf8');

function sliceFunction(fnSignature, approxLength = 2000) {
  const start = SOURCE.indexOf(fnSignature);
  assert.ok(start !== -1, `${fnSignature} must still exist under this exact name`);
  return SOURCE.slice(start, start + approxLength);
}

test('SOURCE PIN: renderActivitiesSection() builds its "Browse Ideas" button via the shared createFromTeachingIdeasButton() helper, never a hand-rolled button', () => {
  const body = sliceFunction('function renderActivitiesSection(');

  assert.match(
    body,
    /addButtonRow\.appendChild\(createFromTeachingIdeasButton\(handlers\.onOpenActivityPicker\)\)/,
    'must call the shared helper with the exact same handler, matching renderSparkSection()\'s own identical-action call site'
  );
  assert.doesNotMatch(
    body,
    /btn--secondary/,
    'must never reintroduce the old, visually-inconsistent btn--secondary tier for this action'
  );
});

test('SOURCE PIN: createFromTeachingIdeasButton() -- the single shared helper both call sites now use -- still renders the tonal-blue pill tier', () => {
  const body = sliceFunction('function createFromTeachingIdeasButton(', 600);

  assert.match(body, /btn--tonal btn--tonal-blue btn--pill/, 'the shared helper must still render the established tonal-blue pill tier both call sites now inherit');
});

test('SOURCE PIN: renderSparkSection() (the other, already-correct call site) also goes through the same shared helper -- confirms both call sites can never visually drift apart again', () => {
  const body = sliceFunction('function renderSparkSection(', 2500);

  const callCount = (body.match(/createFromTeachingIdeasButton\(/g) || []).length;
  assert.ok(callCount >= 1, 'renderSparkSection() must still call the shared helper for its own "Browse Ideas" affordance');
});
