/**
 * tests/ui/connectLearningHubDisplay.test.js
 *
 * Pure-logic coverage for ui/views/ConnectLearningHubDisplay.js — the
 * part of the Connect Learning Hub screen that doesn't need a DOM or
 * Firestore (see that file's own header comment for why it's a
 * separate module at all). Covers the PENDING vs Recently-decided
 * grouping (no merging of distinct requests, even sharing the same
 * invitationCode), the roster-option builder (authorized-classroom-only,
 * never a typed id), truncation, and status label/modifier mapping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusLabel,
  statusModifier,
  truncateLearnerProfileId,
  groupRelationshipsByQueueSection,
  buildRosterOptions,
  buildPendingWaveNotificationId,
} from '../../js/ui/views/ConnectLearningHubDisplay.js';
import { buildRelationshipId, RELATIONSHIP_STATUS } from '../../js/models/LearnerConnection.js';

test('truncateLearnerProfileId shortens long opaque ids and leaves short ones alone', () => {
  assert.equal(truncateLearnerProfileId('a-very-long-opaque-learner-profile-id-123456'), 'a-very-lon…');
  assert.equal(truncateLearnerProfileId('short-id'), 'short-id');
  assert.equal(truncateLearnerProfileId(''), 'unknown learner');
  assert.equal(truncateLearnerProfileId(null), 'unknown learner');
});

test('statusLabel/statusModifier cover every RELATIONSHIP_STATUS value with a real label/modifier, never falling through to the raw enum string', () => {
  for (const status of Object.values(RELATIONSHIP_STATUS)) {
    assert.notEqual(statusLabel(status), undefined);
    assert.notEqual(statusModifier(status), undefined);
  }
  assert.equal(statusLabel(RELATIONSHIP_STATUS.PENDING), 'Pending');
  assert.equal(statusLabel(RELATIONSHIP_STATUS.ACTIVE), 'Verified');
  assert.equal(statusLabel(RELATIONSHIP_STATUS.REJECTED), 'Rejected');
  assert.equal(statusModifier(RELATIONSHIP_STATUS.PENDING), 'pending');
  assert.equal(statusModifier(RELATIONSHIP_STATUS.ACTIVE), 'active');
  assert.equal(statusModifier(RELATIONSHIP_STATUS.REJECTED), 'rejected');
});

test('statusLabel/statusModifier fail safely (never throw) for an unrecognized status', () => {
  assert.equal(statusLabel('SOMETHING_UNEXPECTED'), 'SOMETHING_UNEXPECTED');
  assert.equal(statusModifier('SOMETHING_UNEXPECTED'), 'pending');
});

test('groupRelationshipsByQueueSection: PENDING relationships go to pending, everything else to decided', () => {
  const relationships = [
    { learnerProfileId: 'l1', status: RELATIONSHIP_STATUS.PENDING },
    { learnerProfileId: 'l2', status: RELATIONSHIP_STATUS.ACTIVE },
    { learnerProfileId: 'l3', status: RELATIONSHIP_STATUS.REJECTED },
    { learnerProfileId: 'l4', status: RELATIONSHIP_STATUS.REVOKED },
    { learnerProfileId: 'l5', status: RELATIONSHIP_STATUS.PENDING },
  ];
  const { pending, decided } = groupRelationshipsByQueueSection(relationships);
  assert.deepEqual(pending.map((r) => r.learnerProfileId), ['l1', 'l5']);
  assert.deepEqual(decided.map((r) => r.learnerProfileId), ['l2', 'l3', 'l4']);
});

test('groupRelationshipsByQueueSection never merges distinct pending requests, even when they share the same invitationCode', () => {
  // Two genuinely different learnerProfileIds both used the same
  // classroom-wide invitation code to submit a connection request —
  // the architecture doc's own "multiple pending requests are never
  // merged, even if tied to the same invitation code" requirement.
  const relationships = [
    { learnerProfileId: 'learner-a', classroomId: 'c1', status: RELATIONSHIP_STATUS.PENDING, invitationCode: 'SHARED1' },
    { learnerProfileId: 'learner-b', classroomId: 'c1', status: RELATIONSHIP_STATUS.PENDING, invitationCode: 'SHARED1' },
  ];
  const { pending } = groupRelationshipsByQueueSection(relationships);
  assert.equal(pending.length, 2, 'both requests must remain distinct rows, never collapsed into one because they share an invitationCode');
  assert.deepEqual(pending.map((r) => r.learnerProfileId).sort(), ['learner-a', 'learner-b']);
});

test('groupRelationshipsByQueueSection handles an empty list without throwing', () => {
  const { pending, decided } = groupRelationshipsByQueueSection([]);
  assert.deepEqual(pending, []);
  assert.deepEqual(decided, []);
});

test('buildRosterOptions builds one option per real roster student, value keyed by student id (never a typed/free-form value)', () => {
  const team = { id: 't1', name: 'Alpha' };
  const allRosterStudents = [
    { student: { id: 's1', name: 'Asha' }, team },
    { student: { id: 's2', name: 'Bhavesh' }, team },
  ];
  const options = buildRosterOptions(allRosterStudents);
  assert.deepEqual(options, [
    { value: 's1', label: 'Asha — Alpha' },
    { value: 's2', label: 'Bhavesh — Alpha' },
  ]);
});

test('buildRosterOptions only ever reflects the roster it was given — a different classroom\'s students are never included unless the caller passed them in', () => {
  const classroomARoster = [{ student: { id: 'a1', name: 'A1' }, team: { id: 't', name: 'T' } }];
  const options = buildRosterOptions(classroomARoster);
  assert.equal(options.length, 1);
  assert.equal(options[0].value, 'a1');
});

test('buildRosterOptions on an empty roster returns an empty option list, not a crash or a placeholder "type an id" option', () => {
  assert.deepEqual(buildRosterOptions([]), []);
});

// --------------------------------------------------------------------
// buildPendingWaveNotificationId — the dedup-bug fix: a FIXED
// `connection_requests_${classroomId}` id permanently suppressed every
// notification after the first one ever fired for a classroom. The
// fix keys the id off the OLDEST currently-pending relationship, so a
// fully-resolved wave followed by a genuinely new one gets a fresh id.
// --------------------------------------------------------------------

const CLASSROOM_ID = 'classroom-1';

test('no pending relationships -> null (nothing to notify about)', () => {
  assert.equal(buildPendingWaveNotificationId(CLASSROOM_ID, []), null);
  assert.equal(
    buildPendingWaveNotificationId(CLASSROOM_ID, [{ learnerProfileId: 'l1', status: RELATIONSHIP_STATUS.ACTIVE, createdAt: '2026-01-01T00:00:00.000Z' }]),
    null
  );
});

test('a single pending relationship produces an id keyed on that relationship', () => {
  const id = buildPendingWaveNotificationId(CLASSROOM_ID, [
    { learnerProfileId: 'learner-a', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(id, `connection_requests_${buildRelationshipId('learner-a', CLASSROOM_ID)}`);
});

test('multiple simultaneously pending relationships still aggregate into ONE id (keyed on the oldest), never one id per learner', () => {
  const relationships = [
    { learnerProfileId: 'learner-newer', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-02T00:00:00.000Z' },
    { learnerProfileId: 'learner-oldest', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-01T00:00:00.000Z' },
    { learnerProfileId: 'learner-newest', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-03T00:00:00.000Z' },
  ];
  const id = buildPendingWaveNotificationId(CLASSROOM_ID, relationships);
  assert.equal(id, `connection_requests_${buildRelationshipId('learner-oldest', CLASSROOM_ID)}`);
});

test('a brand-new arrival while the SAME wave is still pending does not change the id (still exactly one notification per wave)', () => {
  const waveBefore = [
    { learnerProfileId: 'learner-oldest', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  const waveAfterNewArrival = [
    ...waveBefore,
    { learnerProfileId: 'learner-brand-new', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-05T00:00:00.000Z' },
  ];
  assert.equal(
    buildPendingWaveNotificationId(CLASSROOM_ID, waveBefore),
    buildPendingWaveNotificationId(CLASSROOM_ID, waveAfterNewArrival),
    'the notification id must not change just because a new request joined an already-pending wave'
  );
});

test('THE DEDUP-BUG FIX, DIRECTLY: once an entire wave resolves (ACTIVE/REJECTED) and a genuinely new wave of pending requests arrives later, the id is DIFFERENT from the first wave\'s — so publishNotificationIfAbsent will not silently no-op forever', () => {
  const firstWaveId = buildPendingWaveNotificationId(CLASSROOM_ID, [
    { learnerProfileId: 'learner-wave-1-a', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-01T00:00:00.000Z' },
    { learnerProfileId: 'learner-wave-1-b', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-02T00:00:00.000Z' },
  ]);

  // The first wave fully resolves (no longer PENDING)...
  const afterFirstWaveResolved = [
    { learnerProfileId: 'learner-wave-1-a', status: RELATIONSHIP_STATUS.ACTIVE, createdAt: '2026-01-01T00:00:00.000Z' },
    { learnerProfileId: 'learner-wave-1-b', status: RELATIONSHIP_STATUS.REJECTED, createdAt: '2026-01-02T00:00:00.000Z' },
  ];
  assert.equal(buildPendingWaveNotificationId(CLASSROOM_ID, afterFirstWaveResolved), null, 'nothing pending -> no notification needed in between waves');

  // ...then, much later, a genuinely new wave of pending requests arrives.
  const secondWave = [
    ...afterFirstWaveResolved,
    { learnerProfileId: 'learner-wave-2-a', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-03-01T00:00:00.000Z' },
  ];
  const secondWaveId = buildPendingWaveNotificationId(CLASSROOM_ID, secondWave);

  assert.notEqual(secondWaveId, firstWaveId, 'a new wave after the first fully resolved must get a DIFFERENT notification id, or it will never fire (the exact bug this fixes)');
  assert.equal(secondWaveId, `connection_requests_${buildRelationshipId('learner-wave-2-a', CLASSROOM_ID)}`);
});

test('a resolved relationship from an old wave never "poisons" a later wave\'s id, even if it is still present in the full relationships array (relationships are never deleted, only transitioned)', () => {
  const relationships = [
    { learnerProfileId: 'old-resolved-1', status: RELATIONSHIP_STATUS.ACTIVE, createdAt: '2026-01-01T00:00:00.000Z' },
    { learnerProfileId: 'old-resolved-2', status: RELATIONSHIP_STATUS.REJECTED, createdAt: '2026-01-02T00:00:00.000Z' },
    { learnerProfileId: 'new-wave-only-pending', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-02-01T00:00:00.000Z' },
  ];
  const id = buildPendingWaveNotificationId(CLASSROOM_ID, relationships);
  assert.equal(id, `connection_requests_${buildRelationshipId('new-wave-only-pending', CLASSROOM_ID)}`);
});

test('the notification id is always classroom-scoped — the same learnerProfileId in two different classrooms produces two different ids', () => {
  const relationships = [{ learnerProfileId: 'shared-learner', status: RELATIONSHIP_STATUS.PENDING, createdAt: '2026-01-01T00:00:00.000Z' }];
  const idForClassroomA = buildPendingWaveNotificationId('classroom-a', relationships);
  const idForClassroomB = buildPendingWaveNotificationId('classroom-b', relationships);
  assert.notEqual(idForClassroomA, idForClassroomB);
});
