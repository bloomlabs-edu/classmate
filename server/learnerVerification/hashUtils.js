/**
 * server/learnerVerification/hashUtils.js
 *
 * Node-side SHA-256, used only by the trusted verification module
 * (verifyLearnerConnection.js) to re-derive the same hash the teacher's
 * browser computed at code-creation time (js/utils/hashUtils.js) — must
 * produce byte-identical hex output for the same input; covered by
 * tests/models/learnerConnection.test.js's own cross-environment
 * assertion.
 */
import { createHash } from 'node:crypto';

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
