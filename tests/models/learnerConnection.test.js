/**
 * tests/models/learnerConnection.test.js
 *
 * Pure-logic tests for models/LearnerConnection.js — no Firestore, no
 * emulator. Covers: the deterministic relationship id, the two code
 * generators' shape/entropy properties, the documented
 * always-null automatic-match behavior (architecture brief item 8), and
 * cross-environment hash equality between the browser (Web Crypto) and
 * server (Node crypto) implementations, since a mismatch there would
 * silently break every real redemption.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelationshipId,
  generateClassroomInvitationCode,
  generateStudentVerificationCode,
  createStudentVerificationCode,
  findTrustedAutomaticMatch,
  RELATIONSHIP_STATUS,
  CODE_STATUS,
} from '../../js/models/LearnerConnection.js';
import { sha256Hex as browserSha256Hex } from '../../js/utils/hashUtils.js';
import { sha256Hex as serverSha256Hex } from '../../server/learnerVerification/hashUtils.js';

test('buildRelationshipId is deterministic and composes learnerProfileId + classroomId', () => {
  assert.equal(buildRelationshipId('learner-1', 'classroom-1'), 'learner-1_classroom-1');
  assert.equal(buildRelationshipId('learner-1', 'classroom-1'), buildRelationshipId('learner-1', 'classroom-1'));
  assert.notEqual(buildRelationshipId('learner-1', 'classroom-1'), buildRelationshipId('learner-2', 'classroom-1'));
});

test('generateClassroomInvitationCode produces a 6-character code from the non-ambiguous alphabet, never two identical codes in a row across many calls', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    const code = generateClassroomInvitationCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    codes.add(code);
  }
  // 200 draws from a 32^6 space should not collide in practice.
  assert.equal(codes.size, 200);
});

test('generateStudentVerificationCode produces a 10-character code with real entropy (no collisions across many draws, non-ambiguous alphabet)', () => {
  const codes = new Set();
  for (let i = 0; i < 500; i++) {
    const code = generateStudentVerificationCode();
    assert.equal(code.length, 10);
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    codes.add(code);
  }
  assert.equal(codes.size, 500);
});

test('findTrustedAutomaticMatch always returns null today — the documented, evidence-based answer, not a placeholder', () => {
  assert.equal(findTrustedAutomaticMatch({ learnerProfileId: 'learner-1', classroomId: 'classroom-1' }), null);
  assert.equal(findTrustedAutomaticMatch({ learnerProfileId: 'anything', classroomId: 'anything' }), null);
  assert.equal(findTrustedAutomaticMatch(), null);
});

test('RELATIONSHIP_STATUS and CODE_STATUS enums are exactly the values the rules/server module rely on', () => {
  assert.deepEqual(RELATIONSHIP_STATUS, { PENDING: 'PENDING', ACTIVE: 'ACTIVE', REVOKED: 'REVOKED', REJECTED: 'REJECTED' });
  assert.deepEqual(CODE_STATUS, { ACTIVE: 'active', REDEEMED: 'redeemed', REVOKED: 'revoked' });
});

test('browser and server SHA-256 implementations produce byte-identical hex for the same input (cross-environment correctness)', async () => {
  const inputs = ['ABCDEFGHJK', '2345Z', '', 'a-realistic-10-char-code'];
  for (const input of inputs) {
    const browserHash = await browserSha256Hex(input);
    const serverHash = serverSha256Hex(input);
    assert.equal(browserHash, serverHash, `mismatch for input ${JSON.stringify(input)}`);
    assert.match(browserHash, /^[0-9a-f]{64}$/);
  }
});

test('createStudentVerificationCode carries learnerProfileId as a first-class field — the binding the security review required (see this function\'s own header comment)', () => {
  const record = createStudentVerificationCode({
    codeHash: 'hash1',
    classroomId: 'classroom-1',
    studentId: 'student-1',
    learnerProfileId: 'learner-1',
    createdByUid: 'teacher-1',
    createdAt: 'now',
    expiresAt: 'later',
  });
  assert.equal(record.learnerProfileId, 'learner-1');
  assert.equal(record.studentId, 'student-1');
  assert.equal(record.classroomId, 'classroom-1');
});

test('SHA-256 hashing is deterministic (same input always produces the same hash) and different inputs produce different hashes', async () => {
  const hashA1 = await browserSha256Hex('CODE-AAAA1');
  const hashA2 = await browserSha256Hex('CODE-AAAA1');
  const hashB = await browserSha256Hex('CODE-BBBB2');
  assert.equal(hashA1, hashA2);
  assert.notEqual(hashA1, hashB);
});
