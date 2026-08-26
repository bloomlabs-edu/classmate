import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createTeam } from '../../js/models/Team.js';
import { createStudent } from '../../js/models/Student.js';
import { createLesson } from '../../js/models/Lesson.js';
import * as conceptFeedbackService from '../../js/services/conceptFeedbackService.js';

function studentWithRecord(name, learningRecord) {
  return createStudent({ name, learningRecord });
}

function classroomWithStudents(students) {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test', gradeSection: 'G1' });
  classroom.teams = [createTeam({ name: 'Alpha', students })];
  return classroom;
}

test('getConceptFeedbackStats: counts responses and the positive (Got it/Can teach) tier correctly', () => {
  // 4 students: 2 respond (one 'confident', one 'need_help'), 2 haven't responded at all.
  const classroom = classroomWithStudents([
    studentWithRecord('A', { 'concept-1': { understanding: 'confident' } }),
    studentWithRecord('B', { 'concept-1': { understanding: 'need_help' } }),
    studentWithRecord('C', {}),
    studentWithRecord('D', {}),
  ]);

  const stats = conceptFeedbackService.getConceptFeedbackStats(classroom, 'concept-1');
  assert.equal(stats.totalStudents, 4);
  assert.equal(stats.respondedCount, 2);
  assert.equal(stats.positiveCount, 1);
  assert.equal(stats.positivePercent, 50);
});

test('getConceptFeedbackStats: a concept nobody has responded to yet has 0% positive, not NaN/undefined', () => {
  const classroom = classroomWithStudents([studentWithRecord('A', {})]);
  const stats = conceptFeedbackService.getConceptFeedbackStats(classroom, 'concept-never-answered');
  assert.equal(stats.respondedCount, 0);
  assert.equal(stats.positivePercent, 0);
});

test('getLessonFeedbackSummary: only includes EXECUTED concepts, never planned-but-not-taught ones', () => {
  const classroom = classroomWithStudents([
    studentWithRecord('A', { A: { understanding: 'confident' }, D: { understanding: 'confident' } }),
  ]);
  // D is planned but NOT executed (e.g. carried forward) — its feedback (if any exists) must not count.
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['A', 'B', 'C', 'D'], executedConceptIds: ['A', 'B', 'C'] });

  const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);
  assert.deepEqual(summary.conceptStats.map((s) => s.conceptId), ['A', 'B', 'C']);
  assert.ok(!summary.conceptStats.some((s) => s.conceptId === 'D'));
});

test('getLessonFeedbackSummary: response rate and understanding are reported as separate numbers, not collapsed into one', () => {
  const classroom = classroomWithStudents([
    studentWithRecord('A', { 'concept-1': { understanding: 'need_help' } }), // responded, but NOT positive
    studentWithRecord('B', {}), // did not respond at all
  ]);
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['concept-1'], executedConceptIds: ['concept-1'] });

  const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);
  assert.equal(summary.respondedStudentCount, 1); // response rate: 1 of 2
  assert.equal(summary.overallUnderstandingPercent, 0); // understanding: the one response was 'need_help', not positive
});

test('getLessonFeedbackSummary: tierCounts covers all 4 student-facing tiers plus not_marked, for the 4-card summary', () => {
  const classroom = classroomWithStudents([
    studentWithRecord('A', { c1: { understanding: 'need_help' } }),
    studentWithRecord('B', { c1: { understanding: 'understand' } }),
    studentWithRecord('C', { c1: { understanding: 'confident' } }),
    studentWithRecord('D', { c1: { understanding: 'can_teach' } }),
  ]);
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['c1'], executedConceptIds: ['c1'] });

  const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);
  assert.equal(summary.tierCounts.need_help, 1);
  assert.equal(summary.tierCounts.understand, 1);
  assert.equal(summary.tierCounts.confident, 1);
  assert.equal(summary.tierCounts.can_teach, 1);
});

test('getLessonFeedbackSummary: a lesson with nothing executed yet has an empty, zeroed summary (no dummy data)', () => {
  const classroom = classroomWithStudents([studentWithRecord('A', {})]);
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['c1'] });

  const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);
  assert.deepEqual(summary.conceptStats, []);
  assert.equal(summary.respondedStudentCount, 0);
  assert.equal(summary.overallUnderstandingPercent, 0);
});

test('getLessonFeedbackSummary: matches the reference\'s own worked example — Not yet 3 (25%), Partly 4 (33%), Got it 3 (25%), Can teach 2 (17%), combined Got it + Can teach 5/12 (42%)', () => {
  // 12 total responses spread across 3 executed concepts so the exact
  // reference tier counts (3/4/3/2) come out of real, independent
  // student answers, not a single contrived shortcut.
  const classroom = classroomWithStudents([
    studentWithRecord('A', { c1: { understanding: 'need_help' }, c2: { understanding: 'need_help' }, c3: { understanding: 'need_help' } }),
    studentWithRecord('B', { c1: { understanding: 'understand' }, c2: { understanding: 'understand' }, c3: { understanding: 'understand' } }),
    studentWithRecord('C', { c1: { understanding: 'understand' }, c2: { understanding: 'confident' }, c3: { understanding: 'confident' } }),
    studentWithRecord('D', { c1: { understanding: 'confident' }, c2: { understanding: 'can_teach' }, c3: { understanding: 'can_teach' } }),
  ]);
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['c1', 'c2', 'c3'], executedConceptIds: ['c1', 'c2', 'c3'] });

  const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);

  assert.equal(summary.totalResponses, 12);
  assert.equal(summary.tierCounts.need_help, 3);
  assert.equal(summary.tierCounts.understand, 4);
  assert.equal(summary.tierCounts.confident, 3);
  assert.equal(summary.tierCounts.can_teach, 2);
  assert.equal(summary.tierPercentages.need_help, 25);
  assert.equal(summary.tierPercentages.understand, 33);
  assert.equal(summary.tierPercentages.confident, 25);
  assert.equal(summary.tierPercentages.can_teach, 17);
  assert.equal(summary.combinedPositiveCount, 5);
  assert.equal(summary.combinedPositivePercent, 42);
});

test('getLessonFeedbackSummary: combined metric is 0/0 (not NaN) when nobody has responded yet', () => {
  const classroom = classroomWithStudents([studentWithRecord('A', {})]);
  const lesson = createLesson({ classroomId: 'c1', conceptIds: ['c1'], executedConceptIds: ['c1'] });
  const summary = conceptFeedbackService.getLessonFeedbackSummary(classroom, lesson);
  assert.equal(summary.totalResponses, 0);
  assert.equal(summary.combinedPositiveCount, 0);
  assert.equal(summary.combinedPositivePercent, 0);
});
