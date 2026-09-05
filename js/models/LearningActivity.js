/**
 * models/LearningActivity.js
 *
 * Describes a Learning Activity — created once at the classroom level
 * (e.g. "Plant Kingdom Worksheet"), then every student gets a status
 * against it (see models/Student.js's `submissions` map and
 * services/learningActivityService.js). This is the "create once, mark
 * the whole roster" workflow: a teacher never edits a submission from
 * inside a single student's profile.
 *
 * This is ClassMate's own "Assignment" abstraction in the sense
 * docs/LEARNING_HUB_INTEGRATION_CONTRACT.md uses that word — a
 * classroom's instance of asking its roster to do something —
 * extended, not replaced, for that integration:
 *
 *   activityId - null for a classic, teacher-authored task with no
 *                separate content definition (every LearningActivity
 *                created before this field existed, and most created
 *                after it too). Set only when this Assignment is an
 *                instance of a reusable models/Activity.js definition
 *                (see services/learningIntegrationService.js's
 *                assignActivityToClassroom()) — e.g. a Learning Hub
 *                experience or an external Kahoot activity.
 *   conceptId  - null unless this Assignment is linked to a
 *                curriculum Concept (models/LearningConcept.js).
 *                Denormalized here even when `activityId` is set (a
 *                copy of that Activity's own `conceptId`) purely so a
 *                caller never has to look up the Activity just to
 *                answer "which Concept is this Assignment for" — and
 *                settable directly for a native ClassMate task with
 *                no separate Activity record at all.
 *
 * Both are additive and optional: existing classrooms' saved
 * LearningActivity documents simply have neither field until next
 * resaved, which reads identically to `null` everywhere in this app
 * that reads them.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createLearningActivity({ id, title, type, dueDate = '', createdAt, pinnedToDashboard = false, activityId = null, conceptId = null } = {}) {
  return {
    id: id || generateId(),
    title,
    type,
    dueDate,
    createdAt: createdAt || getCurrentIsoDate(),
    pinnedToDashboard,
    activityId,
    conceptId,
  };
}
