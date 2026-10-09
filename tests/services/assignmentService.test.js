import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as assignmentService from '../../js/services/assignmentService.js';
import * as assignmentConfigService from '../../js/services/assignmentConfigService.js';

function buildClassroomWithCategory(aspectNames = ['Completion']) {
  const classroom = { assignmentConfig: { categories: [] }, assignments: [] };
  const category = assignmentConfigService.addCategory(classroom, 'Worksheets');
  category.aspects = aspectNames.map((name, i) => ({ id: `asp-${i}`, name }));
  return { classroom, category };
}

test('createNewAssignment assigns incrementing order within its own category only', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const a1 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 1' });
  const a2 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 2' });
  assert.equal(a1.order, 0);
  assert.equal(a2.order, 1);

  const other = assignmentConfigService.addCategory(classroom, 'Projects');
  const a3 = assignmentService.createNewAssignment(classroom, { categoryId: other.id, title: 'Project 1' });
  assert.equal(a3.order, 0, 'a different category starts its own ordering fresh');
});

test('updateAssignment only ever touches metadata — never records, order, or id', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const assignment = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 1' });
  assignmentService.setRating(assignment, 's1', 'asp-0', 'met');
  const originalId = assignment.id;
  const originalOrder = assignment.order;

  assignmentService.updateAssignment(assignment, { title: 'WS 1 (revised)', dueDate: '2026-10-10' });

  assert.equal(assignment.title, 'WS 1 (revised)');
  assert.equal(assignment.dueDate, '2026-10-10');
  assert.equal(assignment.id, originalId);
  assert.equal(assignment.order, originalOrder);
  assert.equal(assignment.records.length, 1, 'renaming must never touch existing student records');
});

test('reorderAssignments reassigns order only within the given category; an id omitted from orderedIds keeps its own order', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const a1 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'A' });
  const a2 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'B' });
  const a3 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'C' });

  assignmentService.reorderAssignments(classroom, category.id, [a2.id, a1.id]);
  assert.equal(a2.order, 0);
  assert.equal(a1.order, 1);
  assert.equal(a3.order, 2, 'omitted id keeps its previous order');
});

test('setRating is sparse — no record exists until a rating is actually set, then only for that one aspect', () => {
  const { classroom, category } = buildClassroomWithCategory(['Completion', 'Accuracy']);
  const assignment = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 1' });
  assert.equal(assignmentService.getRecordForStudent(assignment, 's1'), null);

  assignmentService.setRating(assignment, 's1', 'asp-0', 'developing');
  const record = assignmentService.getRecordForStudent(assignment, 's1');
  assert.deepEqual(record.ratings, { 'asp-0': 'developing' });

  assignmentService.setRating(assignment, 's1', 'asp-1', 'met');
  assert.deepEqual(record.ratings, { 'asp-0': 'developing', 'asp-1': 'met' });
});

test('getAssignmentCellStatus: not_started -> in_progress -> needs_attention -> complete, driven entirely by the category\'s own current aspects', () => {
  const { classroom, category } = buildClassroomWithCategory(['Completion', 'Accuracy']);
  const assignment = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 1' });

  assert.equal(assignmentService.getAssignmentCellStatus(category, null), 'not_started');

  assignmentService.setRating(assignment, 's1', 'asp-0', 'met');
  let record = assignmentService.getRecordForStudent(assignment, 's1');
  assert.equal(assignmentService.getAssignmentCellStatus(category, record), 'in_progress', 'one of two aspects rated');

  assignmentService.setRating(assignment, 's1', 'asp-1', 'not_yet');
  record = assignmentService.getRecordForStudent(assignment, 's1');
  assert.equal(assignmentService.getAssignmentCellStatus(category, record), 'needs_attention', 'all rated, one is not_yet');

  assignmentService.setRating(assignment, 's1', 'asp-1', 'met');
  record = assignmentService.getRecordForStudent(assignment, 's1');
  assert.equal(assignmentService.getAssignmentCellStatus(category, record), 'complete', 'every current aspect rated met');
});

test('getAssignmentCellStatus never resurrects a rating for an aspect the category no longer defines', () => {
  const { classroom, category } = buildClassroomWithCategory(['Completion', 'Accuracy']);
  const assignment = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 1' });
  assignmentService.setRating(assignment, 's1', 'asp-0', 'met');
  assignmentService.setRating(assignment, 's1', 'asp-1', 'met');
  let record = assignmentService.getRecordForStudent(assignment, 's1');
  assert.equal(assignmentService.getAssignmentCellStatus(category, record), 'complete');

  // Teacher removes the Accuracy aspect from the category's taxonomy.
  category.aspects = category.aspects.filter((a) => a.id !== 'asp-1');
  record = assignmentService.getRecordForStudent(assignment, 's1');
  assert.equal(
    assignmentService.getAssignmentCellStatus(category, record),
    'complete',
    'the remaining current aspect (asp-0) is still fully met; the stale asp-1 rating must simply be ignored, not block completion'
  );
  assert.ok('asp-1' in record.ratings, 'the stale rating itself must still be preserved in the record, not deleted');
});

test('countAssignmentImpactForCategory sums assignments and student records for one category only', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const a1 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'A' });
  const a2 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'B' });
  assignmentService.setRating(a1, 's1', 'asp-0', 'met');
  assignmentService.setRating(a1, 's2', 'asp-0', 'met');
  assignmentService.setRating(a2, 's1', 'asp-0', 'met');

  const other = assignmentConfigService.addCategory(classroom, 'Projects');
  assignmentService.createNewAssignment(classroom, { categoryId: other.id, title: 'Unrelated' });

  const impact = assignmentService.countAssignmentImpactForCategory(classroom, category.id);
  assert.deepEqual(impact, { assignmentCount: 2, recordCount: 3 });
});

test('deleteAllAssignmentsForCategory removes every assignment for that category and none for any other', () => {
  const { classroom, category } = buildClassroomWithCategory();
  assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'A' });
  assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'B' });
  const other = assignmentConfigService.addCategory(classroom, 'Projects');
  const untouched = assignmentService.createNewAssignment(classroom, { categoryId: other.id, title: 'Untouched' });

  assignmentService.deleteAllAssignmentsForCategory(classroom, category.id);

  assert.equal(assignmentService.listAssignmentsForCategory(classroom, category.id).length, 0);
  assert.deepEqual(assignmentService.listAssignmentsForCategory(classroom, other.id), [untouched]);
});

test('getAssignmentSummary counts complete/needs_attention/in_progress and derives notStartedCount from a roster', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const assignment = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'A' });
  assignmentService.setRating(assignment, 's1', 'asp-0', 'met'); // complete
  assignmentService.setRating(assignment, 's2', 'asp-0', 'not_yet'); // needs_attention

  const summary = assignmentService.getAssignmentSummary(category, assignment, ['s1', 's2', 's3']);
  assert.equal(summary.completeCount, 1);
  assert.equal(summary.needsAttentionCount, 1);
  assert.equal(summary.notStartedCount, 1);
});

// -----------------------------------------------------------------------
// Interconnectivity: Concepts (conceptIds) + worksheet link
// -----------------------------------------------------------------------

test('createNewAssignment accepts conceptIds and resourceUrl, defaulting to empty/blank when omitted', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const withLinks = assignmentService.createNewAssignment(classroom, {
    categoryId: category.id,
    title: 'Water Cycle Worksheet',
    conceptIds: ['concept-1', 'concept-2'],
    resourceUrl: 'https://docs.example.com/water-cycle',
  });
  assert.deepEqual(withLinks.conceptIds, ['concept-1', 'concept-2']);
  assert.equal(withLinks.resourceUrl, 'https://docs.example.com/water-cycle');

  const withoutLinks = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'No links' });
  assert.deepEqual(withoutLinks.conceptIds, []);
  assert.equal(withoutLinks.resourceUrl, '');
});

test('updateAssignment can change conceptIds/resourceUrl without touching anything else', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const assignment = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'WS 1', conceptIds: ['concept-1'] });
  assignmentService.setRating(assignment, 's1', 'asp-0', 'met');

  assignmentService.updateAssignment(assignment, { conceptIds: ['concept-1', 'concept-2'], resourceUrl: 'https://example.com/ws' });

  assert.deepEqual(assignment.conceptIds, ['concept-1', 'concept-2']);
  assert.equal(assignment.resourceUrl, 'https://example.com/ws');
  assert.equal(assignment.records.length, 1, 'linking concepts must never touch existing student records');
});

test('listAssignmentsForConcept: the "Concept -> linked Assignments" reverse direction is a plain filter, never a stored back-reference', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const linked = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'Linked', conceptIds: ['concept-1'] });
  assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'Unlinked' });
  const otherCategory = assignmentConfigService.addCategory(classroom, 'Projects');
  const linkedInOtherCategory = assignmentService.createNewAssignment(classroom, {
    categoryId: otherCategory.id,
    title: 'Also linked, different category',
    conceptIds: ['concept-1', 'concept-2'],
  });

  const results = assignmentService.listAssignmentsForConcept(classroom, 'concept-1');
  assert.deepEqual(
    results.map((a) => a.id).sort(),
    [linked.id, linkedInOtherCategory.id].sort(),
    'must find linked assignments across every category, and never one that doesn\'t reference this concept'
  );

  assert.deepEqual(assignmentService.listAssignmentsForConcept(classroom, 'concept-does-not-exist'), []);
});

// -----------------------------------------------------------------------
// Interconnectivity: Student Profile evidence (derived, never written back)
// -----------------------------------------------------------------------

test('getAssignmentsForStudent: only assignments with an ACTUAL record for this student show up — sparse, same as the rest of this feature', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const touched = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'Touched' });
  assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'Never touched by this student' });
  assignmentService.setRating(touched, 's1', 'asp-0', 'met');

  const entries = assignmentService.getAssignmentsForStudent(classroom, 's1');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].assignment.id, touched.id);
  assert.equal(entries[0].status, 'complete');
  assert.equal(entries[0].category.id, category.id);

  assert.deepEqual(assignmentService.getAssignmentsForStudent(classroom, 's-never-mentioned'), []);
});

test('getAssignmentsForStudent sorts most-recently-updated first', async () => {
  const { classroom, category } = buildClassroomWithCategory();
  const first = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'First' });
  assignmentService.setRating(first, 's1', 'asp-0', 'met');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'Second' });
  assignmentService.setRating(second, 's1', 'asp-0', 'developing');

  const entries = assignmentService.getAssignmentsForStudent(classroom, 's1');
  assert.deepEqual(entries.map((e) => e.assignment.id), [second.id, first.id]);
});

test('getStudentAssignmentSummary counts only this student\'s own statuses, classroom-wide across every category', () => {
  const { classroom, category } = buildClassroomWithCategory();
  const a1 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'A' });
  const a2 = assignmentService.createNewAssignment(classroom, { categoryId: category.id, title: 'B' });
  assignmentService.setRating(a1, 's1', 'asp-0', 'met'); // complete
  assignmentService.setRating(a2, 's1', 'asp-0', 'not_yet'); // needs_attention
  assignmentService.setRating(a2, 's2', 'asp-0', 'met'); // a different student entirely — must not count toward s1

  const summary = assignmentService.getStudentAssignmentSummary(classroom, 's1');
  assert.deepEqual(summary, { inProgressCount: 0, needsAttentionCount: 1, completeCount: 1 });
});
