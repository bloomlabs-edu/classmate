/**
 * models/AssignmentCategory.js
 *
 * A teacher-defined category within Assignments (e.g. "Worksheets",
 * "Case Studies", "Projects") — see services/assignmentConfigService.js.
 * Stored as an array on classroom.assignmentConfig.categories, directly
 * mirroring models/NotebookType.js's own "flat list on the classroom,
 * teacher adds/renames/removes from Settings" convention. Deliberately
 * ONE level, not Notebook's Subject+Type pair — an Assignment category
 * is not naturally subject-scoped the way a Notebook is (a "Worksheets"
 * category can span any subject), so this doesn't force a layer
 * Assignments doesn't need.
 *
 * `aspects` — the teacher-defined tracking dimensions this category's
 * own Assignments are rated on (e.g. Completion, Accuracy, Quality,
 * Participation, Collaboration). Deliberately an open, per-category
 * list rather than a fixed enum anywhere in the code — see
 * models/StudentAssignmentRecord.js's own header comment for why
 * nothing here hardcodes "participation" the way
 * models/StudentCheckpointRecord.js hardcodes submission/review.
 * Seeded with one sensible default ("Completion") so a brand-new
 * category is immediately usable without requiring configuration
 * first, exactly like a brand-new Notebook Type needs no upfront
 * dailySettings until a teacher actually turns on 'daily' mode.
 */

import { generateId } from '../utils/idGenerator.js';

export function createAssignmentAspect({ id, name } = {}) {
  return { id: id || generateId(), name };
}

export function createAssignmentCategory({ id, name, aspects } = {}) {
  return {
    id: id || generateId(),
    name,
    aspects: aspects || [createAssignmentAspect({ name: 'Completion' })],
  };
}
