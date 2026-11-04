import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudent } from '../../js/models/Student.js';
import * as notebookBadgeService from '../../js/services/notebookBadgeService.js';
import { DEFAULT_NOTEBOOK_BADGE_TYPES } from '../../js/config/notebookBadgeConfig.js';

function makeClassroom() {
  return { settings: { notebookBadgeTypes: DEFAULT_NOTEBOOK_BADGE_TYPES.map((type) => ({ ...type })) } };
}

test('listBadgeTypes: returns the classroom\'s own catalog (the 3 seed types)', () => {
  const classroom = makeClassroom();
  assert.deepEqual(
    notebookBadgeService.listBadgeTypes(classroom).map((type) => type.id),
    ['organization', 'punctuation-champion', 'readiness-champion']
  );
});

test('getBadgeCount: 0 for a student who has never earned a badge', () => {
  const student = createStudent({ name: 'Anjali' });
  assert.equal(notebookBadgeService.getBadgeCount(student, 'organization'), 0);
});

test('awardNotebookBadge: increments the count each time, and logs a Participation History entry', () => {
  const classroom = makeClassroom();
  const student = createStudent({ name: 'Anjali' });

  assert.equal(notebookBadgeService.awardNotebookBadge(classroom, student, 'organization'), 1);
  assert.equal(notebookBadgeService.awardNotebookBadge(classroom, student, 'organization'), 2);

  assert.equal(notebookBadgeService.getBadgeCount(student, 'organization'), 2);
  assert.equal(student.history.length, 2);
  assert.equal(student.history[0].kind, 'notebook-badge');
  assert.equal(student.history[0].label, 'Organization');
  assert.equal(student.history[0].delta, 0);
});

test('awardNotebookBadge: never earned repeatedly is independent per badge type', () => {
  const classroom = makeClassroom();
  const student = createStudent({ name: 'Anjali' });
  notebookBadgeService.awardNotebookBadge(classroom, student, 'organization');
  notebookBadgeService.awardNotebookBadge(classroom, student, 'readiness-champion');
  notebookBadgeService.awardNotebookBadge(classroom, student, 'readiness-champion');

  assert.equal(notebookBadgeService.getBadgeCount(student, 'organization'), 1);
  assert.equal(notebookBadgeService.getBadgeCount(student, 'readiness-champion'), 2);
  assert.equal(notebookBadgeService.getBadgeCount(student, 'punctuation-champion'), 0);
});

test('awardNotebookBadge: an unknown badge type id is a no-op, never throws, never creates a phantom count', () => {
  const classroom = makeClassroom();
  const student = createStudent({ name: 'Anjali' });
  const result = notebookBadgeService.awardNotebookBadge(classroom, student, 'does-not-exist');
  assert.equal(result, 0);
  assert.deepEqual(student.notebookBadgeCounts, {});
  assert.equal(student.history.length, 0);
});

test('listEarnedBadges: includes only badge types with count > 0 — a student must never show a badge they have not earned', () => {
  const classroom = makeClassroom();
  const student = createStudent({ name: 'Anjali' });
  for (let i = 0; i < 4; i += 1) notebookBadgeService.awardNotebookBadge(classroom, student, 'organization');
  notebookBadgeService.awardNotebookBadge(classroom, student, 'readiness-champion');
  // punctuation-champion never awarded for this student

  const earned = notebookBadgeService.listEarnedBadges(classroom, student);
  assert.deepEqual(
    earned.map((badge) => ({ id: badge.id, count: badge.count })),
    [
      { id: 'organization', count: 4 },
      { id: 'readiness-champion', count: 1 },
    ]
  );
});

test('listEarnedBadges: a student with zero badges earned gets an empty list, not an error', () => {
  const classroom = makeClassroom();
  const student = createStudent({ name: 'Anjali' });
  assert.deepEqual(notebookBadgeService.listEarnedBadges(classroom, student), []);
});

test('addBadgeType: adds a new type, trims the name, auto-assigns an icon and a theme', () => {
  const classroom = makeClassroom();
  const added = notebookBadgeService.addBadgeType(classroom, '  Neat Handwriting  ');
  assert.equal(added.name, 'Neat Handwriting');
  assert.ok(added.id);
  assert.equal(added.icon, 'award');
  assert.ok(['amber', 'blue', 'green', 'purple'].includes(added.theme));
  assert.equal(classroom.settings.notebookBadgeTypes.length, 4);
});

test('addBadgeType: rejects a duplicate name case-insensitively, and rejects blank input', () => {
  const classroom = makeClassroom();
  assert.equal(notebookBadgeService.addBadgeType(classroom, 'organization'), null);
  assert.equal(notebookBadgeService.addBadgeType(classroom, '   '), null);
  assert.equal(classroom.settings.notebookBadgeTypes.length, 3);
});

test('addBadgeType: starts the catalog fresh (never throws) when a classroom has none yet', () => {
  const classroom = { settings: {} };
  const added = notebookBadgeService.addBadgeType(classroom, 'Custom Type');
  assert.equal(added.name, 'Custom Type');
  assert.equal(classroom.settings.notebookBadgeTypes.length, 1);
});
