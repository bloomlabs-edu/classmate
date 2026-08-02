/**
 * services/classModeService.js
 *
 * The action layer behind Class Mode: awarding a star, deducting a
 * point, quick-awarding a badge, and quick-changing a bucket, each
 * paired with a matching undo. This is where the click-to-score
 * interaction deferred since Sprint 1 finally gets wired up for real.
 *
 * Every action still logs through services/timelineService.js (so it
 * shows up in the Student Profile's timeline immediately), but this
 * service also keeps a small, session-only, per-classroom undo stack —
 * not persisted, and not the same thing as the Timeline itself. Undoing
 * removes the specific timeline entry the action created and reverses
 * whatever it changed (score, badge, or bucket), so "Undo" here means
 * "take it back entirely," not "log a correction" — different from
 * revoking a badge from the full Student Profile, which deliberately
 * keeps the history entry.
 */

import * as bucketService from './bucketService.js';
import * as badgeService from './badgeService.js';
import * as studentService from './studentService.js';
import * as timelineService from './timelineService.js';
import * as studentEventService from './studentEventService.js';
import { getBucketLabel } from '../config/bucketConfig.js';
import { STUDENT_EVENT_CATEGORIES } from '../config/studentEventCategories.js';

const undoStackByClassroomId = new Map();

function pushUndo(classroomId, undoFn) {
  if (!undoStackByClassroomId.has(classroomId)) undoStackByClassroomId.set(classroomId, []);
  undoStackByClassroomId.get(classroomId).push(undoFn);
}

function removeHistoryEntry(student, entryId) {
  student.history = (student.history || []).filter((entry) => entry.id !== entryId);
}

function lastHistoryEntry(student) {
  return student.history[student.history.length - 1];
}

export function awardStar(classroom, student) {
  const delta = 1;
  const entry = timelineService.logPoints(student, delta, 'Star Awarded');

  pushUndo(classroom.id, () => {
    student.score -= delta;
    removeHistoryEntry(student, entry.id);
  });

  studentEventService.publishEvent(classroom, {
    studentId: student.id,
    type: 'star_awarded',
    category: STUDENT_EVENT_CATEGORIES.RECOGNITION,
    title: '\u2b50 You earned a star!',
    message: 'Your teacher awarded you a star for your effort in class.',
    payload: { delta },
  });

  return entry;
}

export function deductPoint(classroom, student) {
  const delta = -1;
  const entry = timelineService.logPoints(student, delta, 'Negative Point');

  pushUndo(classroom.id, () => {
    student.score -= delta;
    removeHistoryEntry(student, entry.id);
  });

  return entry;
}

/** Returns null if the student already has this badge (nothing to award). */
export function awardBadgeQuick(classroom, student, badgeName) {
  const awarded = badgeService.awardBadge(student, badgeName);
  if (!awarded) return null;

  const entry = lastHistoryEntry(student);
  pushUndo(classroom.id, () => {
    badgeService.revokeBadge(student, badgeName);
    removeHistoryEntry(student, entry.id);
  });

  studentEventService.publishEvent(classroom, {
    studentId: student.id,
    type: 'badge_awarded',
    category: STUDENT_EVENT_CATEGORIES.RECOGNITION,
    title: `\ud83c\udf96\ufe0f You earned the "${badgeName}" badge!`,
    message: 'Your teacher recognized you for this.',
    payload: { badgeName },
  });

  return entry;
}

/** Returns null if the bucket is already set to this value (nothing to change). */
export function changeBucketQuick(classroom, student, newBucket) {
  const previousBucket = student.bucket;
  if (previousBucket === newBucket) return null;

  bucketService.assignBucket(student, newBucket);
  const entry = lastHistoryEntry(student);

  pushUndo(classroom.id, () => {
    student.bucket = previousBucket; // silent revert — no new "Bucket Changed" entry
    removeHistoryEntry(student, entry.id);
  });

  return entry;
}

/**
 * Moves a student to a different group/team, logging it the same way
 * a bucket change is logged, with the same undo support (move back on
 * undo, no new timeline entry for the reversal). The actual move
 * itself is studentService.moveStudentToTeam() — this wraps that with
 * the timeline + undo behavior consistent with every other quick
 * action here. Returns null if the student is already on that team.
 */
export function changeGroupQuick(classroom, currentTeam, student, newTeamId) {
  if (currentTeam.id === newTeamId) return null;

  const newTeam = classroom.teams.find((t) => t.id === newTeamId);
  if (!newTeam) return null;

  const fromTeamId = currentTeam.id;
  const fromTeamName = currentTeam.name;
  const moved = studentService.moveStudentToTeam(classroom, fromTeamId, student.id, newTeamId);
  if (!moved) return null;

  const entry = timelineService.logEntry(student, { kind: 'group', label: `Moved to ${newTeam.name}` });

  pushUndo(classroom.id, () => {
    studentService.moveStudentToTeam(classroom, newTeamId, student.id, fromTeamId); // silent revert — no new "Moved to X" entry
    removeHistoryEntry(student, entry.id);
  });

  return entry;
}

export function undo(classroom) {
  const stack = undoStackByClassroomId.get(classroom.id);
  const undoFn = stack?.pop();
  if (!undoFn) return false;
  undoFn();
  return true;
}

export function canUndo(classroom) {
  return (undoStackByClassroomId.get(classroom.id)?.length || 0) > 0;
}

/** Call after Reset Session — old undo entries would no longer make sense. */
export function clearUndoStack(classroom) {
  undoStackByClassroomId.set(classroom.id, []);
}

export function getBucketOptions() {
  return [
    { key: null, label: getBucketLabel(null) },
    { key: 'green', label: getBucketLabel('green') },
    { key: 'yellow', label: getBucketLabel('yellow') },
    { key: 'red', label: getBucketLabel('red') },
  ];
}
