/**
 * models/Goal.js
 *
 * One student's own goal for one category within one GoalCycle (see
 * models/GoalCycle.js) — e.g. Blessy's own Listening goal, "I will
 * watch a 3-minute English video every day."
 *
 * `categoryId`/`studentId` are references, never copies — the same
 * "store a reference, resolve the current value live" principle
 * applied to AssessmentSubject.subjectId and StudentResult.studentId
 * for exactly the same reason: if a category is renamed, or a student
 * is renamed, every existing goal reflects that automatically rather
 * than freezing a name at creation time.
 *
 * `status` — 'pending_approval' | 'approved'. A goal is fully
 * editable by the student while pending, and locked once approved —
 * "the student cannot edit it," per explicit product decision. An
 * approved-goal editing workflow is an explicit future feature, not
 * built here (see services/goalService.js's own header comment).
 *
 * Does not exist ahead of time for every student/category combination
 * — created only once a student actually submits their own goal text
 * for that category, the same "no row until something is actually
 * entered" convention StudentResult already establishes. A student
 * who hasn't submitted a goal for a category yet simply has no Goal
 * at all; the UI reads the cycle's own category list separately and
 * shows an empty entry form for anyone without one.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createGoal({ id, categoryId, studentId, text = '', status = 'pending_approval', createdAt } = {}) {
  return {
    id: id || generateId(),
    categoryId,
    studentId,
    text,
    status,
    createdAt: createdAt || getCurrentIsoDate(),
  };
}
