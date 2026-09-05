import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createTeam } from '../../js/models/Team.js';
import { createStudent } from '../../js/models/Student.js';
import * as learningActivityService from '../../js/services/learningActivityService.js';

function makeClassroomWithStudent() {
  const student = createStudent({ id: 'student-1', name: 'Alex' });
  const team = createTeam({ id: 'team-1', name: 'Team A', students: [student] });
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A', teams: [team] });
  return { classroom, student };
}

test('createActivity: a plain, legacy-shaped call (no activityId/conceptId) still works exactly as before', () => {
  const { classroom } = makeClassroomWithStudent();
  const activity = learningActivityService.createActivity(classroom, { title: 'Plant Kingdom Worksheet', type: 'Worksheet' });
  assert.equal(activity.activityId, null);
  assert.equal(activity.conceptId, null);
  assert.equal(learningActivityService.listActivities(classroom).length, 1);
});

test('createActivity: an Assignment can identify its Concept', () => {
  const { classroom } = makeClassroomWithStudent();
  const activity = learningActivityService.createActivity(classroom, {
    title: 'Migration Quiz',
    type: 'Quiz',
    activityId: 'activity-1',
    conceptId: 'concept-1',
  });
  assert.equal(activity.activityId, 'activity-1');
  assert.equal(activity.conceptId, 'concept-1');
});

test('setSubmissionStatus: a plain, legacy-shaped call (status + score only) still works exactly as before', () => {
  const { classroom, student } = makeClassroomWithStudent();
  const activity = learningActivityService.createActivity(classroom, { title: 'Homework', type: 'Homework' });
  const result = learningActivityService.setSubmissionStatus(classroom, student, activity.id, 'Submitted', { score: 8 });
  assert.equal(result.status, 'Submitted');
  assert.equal(result.score, 8);
  assert.equal(result.scoreMax, null);
  assert.equal(result.source, 'classmate');
  assert.equal(result.conceptId, null);
});

test('setSubmissionStatus: a scored result identifies student + assignment + concept, and pairs score with scoreMax', () => {
  const { classroom, student } = makeClassroomWithStudent();
  const activity = learningActivityService.createActivity(classroom, {
    title: 'Migration Quiz',
    type: 'Quiz',
    activityId: 'activity-1',
    conceptId: 'concept-1',
  });
  const result = learningActivityService.setSubmissionStatus(classroom, student, activity.id, 'Submitted', {
    score: 8,
    scoreMax: 10,
    completedAt: '2026-01-01T00:00:00.000Z',
    source: 'learning_hub',
    conceptId: 'concept-1',
  });
  assert.equal(result.score, 8);
  assert.equal(result.scoreMax, 10);
  assert.equal(result.source, 'learning_hub');
  assert.equal(result.conceptId, 'concept-1');
  // Full traceability: student (the map this lives on) + assignment (activity.id, the map key) + concept, all resolvable.
  assert.equal(student.submissions[activity.id].conceptId, 'concept-1');
});

test('setSubmissionStatus: an unscored, "Completed / No score" result is fully valid -- score and scoreMax both stay null', () => {
  const { classroom, student } = makeClassroomWithStudent();
  const activity = learningActivityService.createActivity(classroom, { title: 'Reading Log', type: 'Reading Log' });
  const result = learningActivityService.setSubmissionStatus(classroom, student, activity.id, 'Submitted', {});
  assert.equal(result.score, null);
  assert.equal(result.scoreMax, null);
  assert.equal(result.status, 'Submitted');
});

test('getSubmissionStatus: an activity with no entry for this student still defaults to "Not Assigned", unchanged by the new fields', () => {
  const { classroom, student } = makeClassroomWithStudent();
  const activity = learningActivityService.createActivity(classroom, { title: 'Homework', type: 'Homework' });
  assert.equal(learningActivityService.getSubmissionStatus(student, activity.id), 'Not Assigned');
});
