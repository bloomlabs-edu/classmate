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
 * Review Units screen. When absent, the key itself is omitted from
 * the returned object entirely — not set to `undefined` — since
 * Firestore's setDoc() rejects any field whose value is `undefined`
 * (a real, confirmed production bug this omission fixes at the root;
 * see this project's own investigation into why every classroom save
 * with a single-Part Subject was failing).
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
 *
 * Kept as a genuine classroom snapshot rather than derived live from
 * the linked Curriculum Index at render time — deliberate, considered
 * choice: a live lookup would mean an already-assigned classroom's
 * grouping display could silently change (or break entirely) if the
 * source Curriculum Index is later edited or deleted, entirely
 * unrelated to anything the classroom itself did; it would also
 * require a new async lookup for what's currently an instant,
 * synchronous render. Since partName is never independently edited
 * after assignment anyway (confirmed: written in exactly one place,
 * buildUnitsFromCurriculumIndex(), and read only for display grouping
 * in LearningManagementView.js), there is no real benefit to deriving
 * it live to offset that cost.
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningUnit({ id, title, concepts = [], partName, linkedCurriculumUnitId = null, number = null, learningHubPack = null } = {}) {
  const unit = {
    id: id || generateId(),
    title,
    concepts,
    linkedCurriculumUnitId,
    number,
  };
  // Only set the key at all when a real value was given — omitting it
  // entirely (rather than setting it to `undefined`) is what keeps
  // this object safe to pass straight to Firestore's setDoc().
  if (partName !== undefined) {
    unit.partName = partName;
  }

  // `learningHubPack` — optional, nullable, the exact same
  // "reference only, never the referenced thing's own internal
  // composition" convention `linkedCurriculumUnitId` above already
  // established. Shape: { packId, title } — ClassMate never stores
  // a Pack's own Topics/Experiences, only enough to launch it and
  // show a teacher/student what it's called. Omitted entirely (not
  // set to `undefined`) when absent, for the same Firestore-safety
  // reason `partName` above is handled the same way.
  if (learningHubPack !== undefined && learningHubPack !== null) {
    unit.learningHubPack = learningHubPack;
  }

  return unit;
}
