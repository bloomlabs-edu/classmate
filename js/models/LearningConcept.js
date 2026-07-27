/**
 * models/LearningConcept.js
 *
 * The leaf of the syllabus tree: Subject -> Unit -> Concept (see
 * models/LearningSubject.js, models/LearningUnit.js). Named
 * "LearningConcept" rather than the bare "Concept" purely to avoid
 * colliding with the unrelated `NotebookSubject` model's naming
 * space (see that file's own doc comment) — not, as an earlier
 * version of this comment said, to keep this module separate from
 * the rest of the platform. That has changed: per the unified
 * platform architecture (see docs/UNIFIED_PLATFORM_ARCHITECTURE.md),
 * the Concept is now deliberately the one shared join point every
 * concept-attached system hangs off — Learning Record, Resources
 * (see below), and everything Resources will eventually host
 * (worksheets, quizzes, simulations, the future AI tutor). Nothing
 * should bypass the Concept to build a parallel tree of its own.
 *
 * Fields:
 *   status     - whether this concept has been taught to the class
 *                yet (see config/learningRecordConfig.js's
 *                CONCEPT_STATUS_KEYS). Deliberately does NOT hold
 *                understanding/notebook/helpRequested — those vary
 *                per student, so they live in each Student's own
 *                `learningRecord` map, keyed by this concept's id
 *                (see models/StudentConceptRecord.js). Same "shared
 *                entity once, separate per-student record for
 *                anything individual" split this app already uses
 *                for Learning Activities
 *                (models/LearningActivity.js + Student.submissions).
 *   resources  - Resource[] (see models/Resource.js,
 *                services/resourceService.js) — metadata only this
 *                milestone (title + type), no content/editor yet.
 *                Order is array position, the same convention
 *                LearningUnit.concepts and LearningSubject.units
 *                already use — no separate index field to keep in
 *                sync. Older concepts saved before this field
 *                existed simply don't have it yet; every reader goes
 *                through resourceService.getResources(), which
 *                defaults a missing array to `[]` rather than
 *                assuming every concept already has one.
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningConcept({ id, title, status = 'not_taught', resources = [] } = {}) {
  return {
    id: id || generateId(),
    title,
    status,
    resources,
  };
}
