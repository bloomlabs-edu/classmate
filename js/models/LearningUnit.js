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
 *
 * `number` — optional, nullable. Copied once from the linked
 * Curriculum Index Unit's own `number` at the moment a curriculum is
 * assigned (see curriculumLinkingService.js's
 * buildUnitsFromCurriculumIndex()) — this is a classroom snapshot, not
 * a live reference: `title`, `partName`, and `number` are this
 * classroom's own copy from that moment forward, deliberately never
 * re-synced if the source Curriculum Index is later edited. The
 * Curriculum Index remains the source of truth for any *future*
 * assignment; an already-assigned classroom keeps whatever it was
 * given, including any customization a teacher makes to their own
 * copy afterward. Per explicit product decision — see this project's
 * own Learning view unit-number investigation for why this distinction
 * matters.
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningUnit({ id, title, concepts = [], partName = undefined, linkedCurriculumUnitId = null, number = null } = {}) {
  return {
    id: id || generateId(),
    title,
    concepts,
    partName,
    linkedCurriculumUnitId,
    number,
  };
}
