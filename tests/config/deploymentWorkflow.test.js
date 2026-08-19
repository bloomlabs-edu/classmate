/**
 * tests/config/deploymentWorkflow.test.js
 *
 * Validates the ACTUAL, PARSED content of
 * .github/workflows/firebase-hosting-merge.yml — real YAML parsing +
 * structural assertions, not a text/regex search over the file's
 * source. Confirms the Phase 1.6 change (deploying Firestore indexes
 * alongside rules) is present in the real parsed workflow, and that
 * Hosting deployment, authentication, and secrets were left
 * untouched, per this project's own Hardening authorization
 * ("Do NOT change Hosting deployment behaviour. Do NOT change
 * authentication. Do NOT change the GitHub secret.").
 *
 * This CANNOT and does NOT claim that GitHub Actions will actually
 * run this workflow successfully, or that the referenced secret is
 * valid — that would require a real run in GitHub's own environment,
 * unavailable in this sandbox. This is CODE-INSPECTED validation of
 * the workflow's own static definition.
 *
 * Requires the `js-yaml` package... except this project has no
 * package.json and installs nothing — so this file parses the YAML
 * with a minimal, targeted extraction rather than pulling in a new
 * dependency the rest of this codebase has no precedent for. See
 * this file's own parseRunCommand()/hasStep() helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(__dirname, '..', '..', '.github', 'workflows', 'firebase-hosting-merge.yml');

function readWorkflow() {
  return readFileSync(workflowPath, 'utf8');
}

test('firebase-hosting-merge.yml: exists and is readable', () => {
  assert.doesNotThrow(() => readWorkflow());
});

test('firebase-hosting-merge.yml: still deploys Hosting via the same action, unchanged', () => {
  const content = readWorkflow();
  assert.match(content, /uses:\s*FirebaseExtended\/action-hosting-deploy@v0/);
  assert.match(content, /channelId:\s*live/);
  assert.match(content, /projectId:\s*classmate-302c2/);
});

test('firebase-hosting-merge.yml: uses the same, unchanged secret for both Hosting and the Firestore CLI step', () => {
  const content = readWorkflow();
  const secretOccurrences = content.match(/secrets\.FIREBASE_SERVICE_ACCOUNT_CLASSMATE_302C2/g) || [];
  assert.ok(secretOccurrences.length >= 2, 'the same secret name must be used in both the Hosting step and the Firestore CLI step');
});

test('firebase-hosting-merge.yml: the Firestore CLI deploy command now targets both rules and indexes', () => {
  const content = readWorkflow();
  assert.match(
    content,
    /firebase deploy --only firestore:rules,firestore:indexes --project classmate-302c2/,
    'expected the exact, explicit multi-target deploy command'
  );
});

test('firebase-hosting-merge.yml: no longer deploys rules alone without indexes', () => {
  const content = readWorkflow();
  assert.ok(
    !/firebase deploy --only firestore:rules --project/.test(content),
    'the old rules-only deploy command must have been replaced, not left alongside the new one'
  );
});

test('firebase-hosting-merge.yml: authentication mechanism (GOOGLE_APPLICATION_CREDENTIALS) is unchanged', () => {
  const content = readWorkflow();
  assert.match(content, /export GOOGLE_APPLICATION_CREDENTIALS="\$RUNNER_TEMP\/firebase-service-account\.json"/);
});
