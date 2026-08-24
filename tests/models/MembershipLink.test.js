/**
 * tests/models/MembershipLink.test.js
 *
 * PHASE 1 — Membership Identity Foundation. Only createMembershipLink()
 * is pure/DOM-and-Firestore-free and thus executable here.
 * membershipLinkService.js's own ensureMembershipLinkForCurrentStudent()
 * and firestoreMembershipLinkRepository.js cannot be exercised in this
 * sandbox — they import the Firebase SDK via an https:// URL, which
 * Node's default ESM loader rejects (only file:/data:/node: specifiers
 * are supported), and this sandbox has no live or emulated Firestore
 * project to test against regardless. This is the same, already-
 * documented limitation every other Firestore-touching file in this
 * project has — see e.g. services/programmeSessionRepository.js's own
 * header comment. Verified fresh for this Phase (not assumed): see
 * this Phase's own implementation report for the exact command run
 * and its output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMembershipLink } from '../../js/models/MembershipLink.js';

test('createMembershipLink: produces exactly the three documented fields, no more', () => {
  const link = createMembershipLink({ studentId: 'student-1', joinedAt: '2026-08-19T10:00:00.000Z' });
  assert.deepEqual(Object.keys(link).sort(), ['joinedAt', 'status', 'studentId']);
});

test('createMembershipLink: defaults status to active', () => {
  const link = createMembershipLink({ studentId: 'student-1', joinedAt: '2026-08-19T10:00:00.000Z' });
  assert.equal(link.status, 'active');
});

test('createMembershipLink: preserves the given studentId and joinedAt exactly', () => {
  const link = createMembershipLink({ studentId: 'student-42', joinedAt: '2026-08-01T00:00:00.000Z' });
  assert.equal(link.studentId, 'student-42');
  assert.equal(link.joinedAt, '2026-08-01T00:00:00.000Z');
});

test('createMembershipLink: never includes a programmeId field — that value only ever comes from the document path, never a stored field', () => {
  const link = createMembershipLink({ studentId: 'student-1', joinedAt: '2026-08-19T10:00:00.000Z' });
  assert.equal('programmeId' in link, false);
});

test('createMembershipLink: never includes a uid field — the document ID itself is the uid, never duplicated inside the document', () => {
  const link = createMembershipLink({ studentId: 'student-1', joinedAt: '2026-08-19T10:00:00.000Z' });
  assert.equal('uid' in link, false);
});

test('createMembershipLink: an explicit status overrides the default', () => {
  const link = createMembershipLink({ studentId: 'student-1', joinedAt: '2026-08-19T10:00:00.000Z', status: 'left' });
  assert.equal(link.status, 'left');
});
