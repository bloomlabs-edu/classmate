import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { ensureVisitorAccessCode, revokeVisitorAccessCode, ensureProgramManagerJoinCode, upsertClassroom, updateClassroomDetails, getClassroomById, ClassroomValidationError } from '../../js/services/classroomService.js';
import * as assignmentConfigService from '../../js/services/assignmentConfigService.js';

test('ensureVisitorAccessCode: generates a code once, and is a no-op if one already exists', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  assert.equal(classroom.visitorAccessCode, null);

  const created = ensureVisitorAccessCode(classroom);
  assert.equal(created, true);
  assert.ok(classroom.visitorAccessCode);

  const existingCode = classroom.visitorAccessCode;
  const createdAgain = ensureVisitorAccessCode(classroom);
  assert.equal(createdAgain, false);
  assert.equal(classroom.visitorAccessCode, existingCode); // never silently regenerated over an existing code
});

test('revokeVisitorAccessCode: clears the classroom\'s own pointer back to null', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  ensureVisitorAccessCode(classroom);
  assert.ok(classroom.visitorAccessCode);

  revokeVisitorAccessCode(classroom);
  assert.equal(classroom.visitorAccessCode, null);
});

test('ensureProgramManagerJoinCode: generates a code once, and is a no-op if one already exists', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  assert.equal(classroom.programManagerJoinCode, null);

  const created = ensureProgramManagerJoinCode(classroom);
  assert.equal(created, true);
  assert.ok(classroom.programManagerJoinCode);

  const existingCode = classroom.programManagerJoinCode;
  const createdAgain = ensureProgramManagerJoinCode(classroom);
  assert.equal(createdAgain, false);
  assert.equal(classroom.programManagerJoinCode, existingCode);
});

test('ensureProgramManagerJoinCode: generates a DIFFERENT code from classroomJoinCode — the two must never be interchangeable', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  classroom.classroomJoinCode = 'ABC123';
  ensureProgramManagerJoinCode(classroom);
  assert.notEqual(classroom.programManagerJoinCode, classroom.classroomJoinCode);
});

/**
 * Regression coverage for the production crash reported against the
 * Assignment Tracker: `TypeError: Cannot read properties of undefined
 * (reading 'categories')` in assignmentConfigService.js's own
 * listCategories(). Root cause -- a classroom document saved to
 * Firestore BEFORE the Assignment feature existed has no
 * `assignmentConfig` field at all (models/Classroom.js's own
 * `assignmentConfig = { categories: [] }` default only applies when
 * createClassroom() itself builds a brand-new classroom; it never runs
 * again for a classroom loaded back out of Firestore). upsertClassroom()
 * -- the one function every Firestore snapshot for every classroom
 * passes through (see workspaceService.js) -- already backfills
 * notebookConfig the exact same way for the identical reason; it simply
 * never got the matching line for assignmentConfig when that feature
 * shipped. These tests exercise upsertClassroom() directly with a raw,
 * plain object shaped like real legacy Firestore data (no
 * createClassroom() call involved), the same way a real snapshot
 * listener callback receives one.
 */
test('upsertClassroom: backfills assignmentConfig for a classroom document saved before the Assignment feature existed', () => {
  const legacyClassroomData = {
    id: 'legacy-1',
    schoolName: 'A School',
    gradeSection: 'Grade 8',
    teams: [],
    // No `assignmentConfig` key at all -- exactly what a classroom
    // document written before this feature existed looks like.
  };

  const normalized = upsertClassroom(legacyClassroomData);

  assert.deepEqual(normalized.assignmentConfig, { categories: [] });
  // The exact call site that crashed in production -- must now return
  // an empty array instead of throwing.
  assert.deepEqual(assignmentConfigService.listCategories(normalized), []);
});

test('upsertClassroom: never overwrites an existing classroom\'s already-saved assignment categories', () => {
  const existingCategory = { id: 'cat-1', name: 'Worksheets', aspects: [] };
  const classroomData = {
    id: 'legacy-2',
    schoolName: 'A School',
    gradeSection: 'Grade 8',
    teams: [],
    assignmentConfig: { categories: [existingCategory] },
  };

  const normalized = upsertClassroom(classroomData);

  assert.deepEqual(normalized.assignmentConfig.categories, [existingCategory]);
  assert.deepEqual(assignmentConfigService.listCategories(normalized), [existingCategory]);
});

test('upsertClassroom: never overwrites an existing student roster while backfilling assignmentConfig', () => {
  const existingStudent = { id: 's1', name: 'Asha', score: 7, bucket: 'green', badges: ['star'], notes: [], submissions: {}, history: [{ id: 'h1' }] };
  const classroomData = {
    id: 'legacy-3',
    schoolName: 'A School',
    gradeSection: 'Grade 8',
    teams: [{ id: 't1', name: 'Team 1', students: [existingStudent] }],
    // No assignmentConfig, same as a real legacy document.
  };

  const normalized = upsertClassroom(classroomData);

  assert.deepEqual(normalized.assignmentConfig, { categories: [] });
  assert.deepEqual(normalized.teams[0].students[0], existingStudent);
});

// ---------------------------------------------------------------------
// updateClassroomDetails — the one write path ui/components/
// EditClassroomDetailsModal.js's "Edit Classroom Details" action goes
// through (see ui/views/DashboardView.js). These tests exercise it the
// same way that caller does: an existing, already-registered classroom
// (via upsertClassroom, mirroring a real Firestore-loaded classroom),
// updated in place by id.
// ---------------------------------------------------------------------

test('updateClassroomDetails: updates classroomName and description on the existing classroom, preserving id, members, memberUids, and teams exactly', () => {
  const existingStudent = { id: 's1', name: 'Anjali', score: 0, bucket: null, badges: [], notes: [], submissions: {}, history: [] };
  const classroom = upsertClassroom({
    id: 'edit-details-c1',
    schoolName: 'CHS Kannamapet',
    gradeSection: 'Grade 8A',
    classroomName: 'Old Name',
    description: 'Old description',
    ownerUid: 'owner-uid',
    members: { 'owner-uid': { role: 'owner', displayName: 'The Owner', joinedAt: '2026-01-01' } },
    memberUids: ['owner-uid'],
    teams: [{ id: 't1', name: 'Team 1', students: [existingStudent] }],
  });

  const result = updateClassroomDetails('edit-details-c1', { classroomName: 'Bloom Force 19', description: 'New description' });

  assert.equal(result.classroomName, 'Bloom Force 19');
  assert.equal(result.description, 'New description');
  // Everything else on the classroom is untouched.
  assert.equal(result.id, 'edit-details-c1');
  assert.equal(result.schoolName, 'CHS Kannamapet');
  assert.equal(result.gradeSection, 'Grade 8A');
  assert.equal(result.ownerUid, 'owner-uid');
  assert.deepEqual(result.members, { 'owner-uid': { role: 'owner', displayName: 'The Owner', joinedAt: '2026-01-01' } });
  assert.deepEqual(result.memberUids, ['owner-uid']);
  assert.deepEqual(result.teams[0].students[0], existingStudent);
  // The exact same object reference the classroom was already stored as
  // — matching every other in-place classroom mutation in this app
  // (e.g. ui/views/ConceptWorkspaceView.js's description editor), not a
  // new object a re-render would need threading through.
  assert.equal(result, classroom);
});

test('updateClassroomDetails: an empty description is accepted (it is optional)', () => {
  upsertClassroom({ id: 'edit-details-c2', schoolName: 'A School', gradeSection: 'Grade 8', classroomName: 'Name', description: 'Has a description' });

  const result = updateClassroomDetails('edit-details-c2', { classroomName: 'Still Has A Name', description: '' });

  assert.equal(result.classroomName, 'Still Has A Name');
  assert.equal(result.description, '');
});

test('updateClassroomDetails: clearing classroomName back to empty is allowed at the service layer (the UI-level "must not be empty" rule lives in the modal, not here — classroomName itself is optional on the model)', () => {
  upsertClassroom({ id: 'edit-details-c3', schoolName: 'A School', gradeSection: 'Grade 8', classroomName: 'Name' });

  const result = updateClassroomDetails('edit-details-c3', { classroomName: '' });

  assert.equal(result.classroomName, '');
  // Required fields are still enforced — clearing School Name itself must still throw.
  assert.throws(() => updateClassroomDetails('edit-details-c3', { schoolName: '' }), ClassroomValidationError);
});

test('updateClassroomDetails: returns null for an id that is not in memory, without throwing', () => {
  assert.equal(updateClassroomDetails('does-not-exist', { classroomName: 'x' }), null);
});

// ---------------------------------------------------------------------
// Stale-reference regression (pre-commit review, 2026-10-27) —
// ui/views/DashboardView.js's "Edit Classroom Details" save callback
// used to pass its own outer `classroom` closure variable to
// workspaceService.saveExplicitly(), instead of the object
// updateClassroomDetails() actually mutated and returned. Those are
// only the same object as long as classroomService.upsertClassroom()
// (below) hasn't REPLACED the in-memory array slot with a new object
// since the Dashboard captured its own `classroom` reference — which it
// does on every incoming Firestore snapshot. The fix is to always use
// updateClassroomDetails()'s own return value from that point on; this
// test exercises exactly that mechanism, at the classroomService layer
// where the actual bug and fix both live.
//
// Deliberately NOT a DashboardView.js/Playwright integration test: that
// callback is a private closure (not exported), and
// workspaceService.saveExplicitly() performs a real Firestore write
// with no mocking/spy convention anywhere in this codebase (ES module
// named exports are read-only live bindings — they can't be
// monkey-patched from a test the way a CommonJS/Jest mock could be).
// Reproducing the race through a full Dashboard render + emulator write
// would mean rebuilding a large, brittle integration fixture (router,
// widgets, a full roster) just to reach three lines of reference
// plumbing whose entire failure mode is reproducible, deterministically
// and non-brittly, right here with classroomService alone.
// ---------------------------------------------------------------------

test('updateClassroomDetails: the object it returns reflects a concurrent in-memory replacement, proving a caller must use THIS return value rather than a reference captured before that replacement', () => {
  const existingStudent = { id: 's1', name: 'Anjali', score: 0, bucket: null, badges: [], notes: [], submissions: {}, history: [] };
  const members = { 'owner-uid': { role: 'owner', displayName: 'The Owner', joinedAt: '2026-01-01' } };

  // 1. The Dashboard renders and captures its own `classroom` reference
  //    — exactly what ui/views/DashboardView.js's `const { classroom } = props`
  //    would hold, and what the "Edit Classroom Details" modal's own
  //    closure captures when the teacher opens it.
  const staleClassroomReference = upsertClassroom({
    id: 'race-c1',
    schoolName: 'CHS Kannamapet',
    gradeSection: 'Grade 8A',
    classroomName: 'Old Name',
    description: 'Old description',
    ownerUid: 'owner-uid',
    members,
    memberUids: ['owner-uid'],
    teams: [{ id: 't1', name: 'Team 1', students: [existingStudent] }],
  });

  // 2. Before the teacher clicks Save, an incoming Firestore snapshot
  //    for this SAME classroom id lands — e.g. a co-teacher added a
  //    second student. upsertClassroom() REPLACES the array slot with a
  //    brand-new object (see that function's own implementation:
  //    `classrooms[index] = normalized`), it never mutates the existing
  //    one in place — so `staleClassroomReference` above is now a
  //    genuinely stale, detached object the live classroomService array
  //    no longer contains.
  const newStudent = { id: 's2', name: 'Bhavani', score: 0, bucket: null, badges: [], notes: [], submissions: {}, history: [] };
  upsertClassroom({
    id: 'race-c1',
    schoolName: 'CHS Kannamapet',
    gradeSection: 'Grade 8A',
    classroomName: 'Old Name',
    description: 'Old description',
    ownerUid: 'owner-uid',
    members,
    memberUids: ['owner-uid'],
    teams: [{ id: 't1', name: 'Team 1', students: [existingStudent, newStudent] }],
  });

  // Confirms the race precondition is real, not a no-op: the two really
  // are different object references sharing the same id.
  assert.notEqual(getClassroomById('race-c1'), staleClassroomReference);

  // 3. The teacher now clicks Save on the modal, which (per the fixed
  //    ui/views/DashboardView.js) calls updateClassroomDetails() using
  //    the stale reference's own `.id` (ids never change, so this part
  //    is always safe) and relies ENTIRELY on the return value for
  //    everything downstream — never the stale reference itself.
  const updatedClassroom = updateClassroomDetails(staleClassroomReference.id, {
    classroomName: 'New Name',
    description: 'New description',
  });

  // The fix's core guarantee: this is NOT the object the Dashboard/modal
  // had captured — it's the live, current one, carrying both this edit
  // AND the concurrent roster change from step 2.
  assert.notEqual(updatedClassroom, staleClassroomReference);
  assert.equal(updatedClassroom, getClassroomById('race-c1'));

  // The new edit landed...
  assert.equal(updatedClassroom.classroomName, 'New Name');
  assert.equal(updatedClassroom.description, 'New description');
  // ...id, ownership, and membership are preserved exactly...
  assert.equal(updatedClassroom.id, 'race-c1');
  assert.equal(updatedClassroom.ownerUid, 'owner-uid');
  assert.deepEqual(updatedClassroom.members, members);
  assert.deepEqual(updatedClassroom.memberUids, ['owner-uid']);
  // ...and the CONCURRENT change (the second student) survived — proving
  // this is the fresh object, not a copy of the stale one re-applied.
  assert.deepEqual(updatedClassroom.teams[0].students, [existingStudent, newStudent]);

  // Negative check, demonstrating exactly what the bug was: the stale
  // reference itself was never touched by this update at all — passing
  // IT to saveExplicitly() (the old, buggy code) would have silently
  // written the OLD name/description back to Firestore, reverting both
  // this edit and the concurrent roster change in one write.
  assert.equal(staleClassroomReference.classroomName, 'Old Name');
  assert.equal(staleClassroomReference.description, 'Old description');
  assert.equal(staleClassroomReference.teams[0].students.length, 1);
});
