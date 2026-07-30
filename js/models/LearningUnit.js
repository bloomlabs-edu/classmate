/**
 * models/LearningUnit.js
 *
 * The middle tier of the Learning Record syllabus tree: Subject ->
 * Unit -> Concept (see models/LearningSubject.js,
 * models/LearningConcept.js). A Unit owns its concepts directly, the
 * same "owns its children as a plain array" pattern Team uses for
 * Student (see models/Team.js).
 *
 * `partName` — optional, free text, exactly like a Curriculum Index's
 * own Part name (see js/services/curriculumIndexRepository.js).
 * Grouping metadata only, for display — a Subject linked from a
 * single-Part Curriculum Index (Science's "General") never sets this
 * at all, so it never shows Part-grouping machinery a teacher never
 * asked for; a Subject linked from a multi-Part curriculum (Social
 * Science) sets it per-Unit so ui/views/LearningManagementView.js can
 * group units under their Part for display, the same "hide grouping
 * when there's only one" rule already used for Curriculum Index's own
 * Review Units screen.
 *
 * `linkedCurriculumUnitId` — optional, nullable. Set only when this
 * Unit was created by linking a Curriculum Index (see
 * services/curriculumLinkingService.js); null for a Unit a teacher
 * added directly the existing way. This is what a future Concept
 * Builder needs to find "which LearningUnit does this Curriculum
 * Index Unit's Concepts belong to" — not used for anything today.
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningUnit({ id, title, concepts = [], partName = undefined, linkedCurriculumUnitId = null } = {}) {
  return {
    id: id || generateId(),
    title,
    concepts,
    partName,
    linkedCurriculumUnitId,
  };
}
