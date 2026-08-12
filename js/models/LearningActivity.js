/**
 * models/LearningActivity.js
 *
 * Describes a Learning Activity — created once at the classroom level
 * (e.g. "Plant Kingdom Worksheet"), then every student gets a status
 * against it (see models/Student.js's `submissions` map and
 * services/learningActivityService.js). This is the "create once, mark
 * the whole roster" workflow: a teacher never edits a submission from
 * inside a single student's profile.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createLearningActivity({ id, title, type, dueDate = '', createdAt, pinnedToDashboard = false } = {}) {
  return {
    id: id || generateId(),
    title,
    type,
    dueDate,
    createdAt: createdAt || getCurrentIsoDate(),
    pinnedToDashboard,
  };
}
