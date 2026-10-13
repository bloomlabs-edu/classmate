/**
 * tests/services/classModeService.test.js
 *
 * Direct unit coverage for services/classModeService.js's deductPoint()
 * (and a companion awardStar() check) — this service had NO direct unit
 * tests before this file; only the gesture-wiring half was covered (see
 * tests/ui/classModeStudentRow.test.js). Added specifically to lock in
 * the desktop remove-star button's own requirement: deductPoint() must
 * never clamp or impose a lower bound — removal must work identically
 * whether the student's score is currently positive, zero, or already
 * negative, per explicit product decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createStudent } from '../../js/models/Student.js';
import * as classModeService from '../../js/services/classModeService.js';

function buildClassroomWithStudent({ score = 0 } = {}) {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  const student = createStudent({ id: 's1', name: 'Asha', score });
  classroom.teams = [{ id: 't1', name: 'Team 1', students: [student] }];
  return { classroom, student };
}

test('deductPoint: a positive score decreases by exactly 1, never clamped toward zero', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: 3 });
  classModeService.deductPoint(classroom, student);
  assert.equal(student.score, 2);
});

test('deductPoint: a score of exactly 0 goes negative — removal is never disabled or no-op at zero', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: 0 });
  classModeService.deductPoint(classroom, student);
  assert.equal(student.score, -1);
});

test('deductPoint: an already-negative score keeps decreasing — no artificial floor', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: -2 });
  classModeService.deductPoint(classroom, student);
  assert.equal(student.score, -3);
});

test('deductPoint: repeated removals accumulate correctly across positive, zero, and negative territory', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: 1 });
  classModeService.deductPoint(classroom, student);
  classModeService.deductPoint(classroom, student);
  classModeService.deductPoint(classroom, student);
  assert.equal(student.score, -2);
  assert.equal(student.history.length, 3);
});

test('deductPoint: appends a real history entry — kind "points", delta -1, labeled "Negative Point"', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: 5 });
  const entry = classModeService.deductPoint(classroom, student);
  assert.equal(entry.kind, 'points');
  assert.equal(entry.delta, -1);
  assert.equal(entry.label, 'Negative Point');
  assert.equal(student.history.at(-1).id, entry.id);
});

test('deductPoint: pushes a working undo entry onto the session undo stack — undo restores the exact prior score and removes the history entry', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: 0 });
  classModeService.deductPoint(classroom, student);
  assert.equal(student.score, -1);
  assert.equal(classModeService.canUndo(classroom), true);

  const undone = classModeService.undo(classroom);
  assert.equal(undone, true);
  assert.equal(student.score, 0);
  assert.equal(student.history.length, 0);
});

test('awardStar + deductPoint together: net score reflects plain arithmetic with no floor, matching getNetPoints()', () => {
  const { classroom, student } = buildClassroomWithStudent({ score: 0 });
  classModeService.awardStar(classroom, student);
  classModeService.deductPoint(classroom, student);
  classModeService.deductPoint(classroom, student);
  assert.equal(student.score, -1);
});
