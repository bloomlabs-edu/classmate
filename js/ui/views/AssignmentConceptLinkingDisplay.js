/**
 * ui/views/AssignmentConceptLinkingDisplay.js
 *
 * Pure, DOM-free logic for the Assignment form's Subject -> Unit ->
 * Concept cascade (see ui/views/AssignmentTrackerView.js's own
 * renderAssignmentForm(), which only ever reads this module's state —
 * it never re-derives any of this itself). Split out from that view
 * the same way ui/views/KnowledgeAuthoringDisplay.js is split from
 * KnowledgeAuthoringView.js: the cascading-select state machine is
 * exactly the kind of logic that's cheap to unit test directly and
 * expensive to test only through rendered DOM.
 *
 * ROOT CAUSE this file fixes: the Assignment form's "Link concepts"
 * list used to show every concept in the ENTIRE classroom (every
 * Subject, every Unit, via learningRecordService.getAllConcepts()),
 * merely grouped under subject/unit headings for scannability — not
 * actually filtered by anything a teacher chose. There was no Unit
 * selector at all. This file is the fix: Unit options are scoped to
 * the selected Subject, and Concept options are scoped to the
 * selected Unit, using the exact same Subject -> Unit -> Concept
 * containment models/LearningSubject.js / models/LearningUnit.js /
 * models/LearningConcept.js already define — not a new relationship.
 *
 * NO NEW DATA MODEL / NO NEW FIELD: models/Assignment.js's own header
 * comment already states the deliberate architecture this follows —
 * "Curriculum context (Subject/Unit) is never duplicated here...
 * it's recovered by walking up from the linked Concept via
 * learningRecordService.findConcept()". `subjectId` is the one
 * existing exception (an explicit, separately-justified metadata
 * pill — see that field's own comment) and is reused here unchanged.
 * Unit is deliberately NOT a new stored field: inferInitialUnitId()
 * below recovers it by walking up from the Assignment's own
 * `conceptIds` through learningRecordService.findConcept(), exactly
 * as that comment prescribes — so editing an existing Assignment
 * reload-reconstructs its Unit selection from already-persisted data,
 * with zero migration and zero new Firestore fields.
 *
 * LEGACY DATA: an Assignment saved before this fix could have
 * `conceptIds` spanning more than one Unit (nothing previously
 * stopped that). inferInitialUnitId() only resolves to a single Unit
 * when every linked concept that still exists shares exactly one —
 * otherwise it returns null (no single Unit is "the" answer) WITHOUT
 * touching `conceptIds` itself. The view's own job is to then show
 * those still-selected concepts without forcing a Unit choice, never
 * silently dropping them — see that file's own handling of a null
 * unit with a non-empty selection.
 */

import * as learningRecordService from '../../services/learningRecordService.js';

/** Every Unit belonging to `subjectId`, or [] if no subject is selected or it has none. Never throws on an unknown subjectId. */
export function getUnitsForSubject(classroom, subjectId) {
  if (!subjectId) return [];
  const subject = learningRecordService.getSubjectById(classroom, subjectId);
  return subject ? subject.units : [];
}

/** Every Concept belonging to `unitId` within `subjectId`, or [] if either is unset/unresolved. */
export function getConceptsForUnit(classroom, subjectId, unitId) {
  if (!subjectId || !unitId) return [];
  const unit = getUnitsForSubject(classroom, subjectId).find((u) => u.id === unitId);
  return unit ? unit.concepts : [];
}

/**
 * Recovers "which Unit does this Assignment's existing conceptIds
 * belong to" by walking up from each concept (see this file's own
 * header comment). A conceptId that no longer resolves to a real
 * Concept (deleted since) is silently skipped, same as
 * ui/views/AssignmentTrackerView.js's own buildConceptChips() already
 * does for display. Returns null — never a guess — when the concepts
 * span zero or more than one Unit; the caller must treat null as
 * "no single Unit to preselect," not as an error.
 */
export function inferInitialUnitId(classroom, conceptIds) {
  const unitIds = new Set();
  (conceptIds || []).forEach((conceptId) => {
    const found = learningRecordService.findConcept(classroom, conceptId);
    if (found) unitIds.add(found.unit.id);
  });
  return unitIds.size === 1 ? [...unitIds][0] : null;
}

/**
 * The cascade's one source of truth, DOM-free. `classroom` is read
 * live on every call (matches this app's own existing
 * reference-not-copy convention) — this object never caches a stale
 * copy of Units/Concepts, only the three small pieces of actual
 * selection state a teacher has made.
 */
export function createAssignmentConceptLinkState(classroom, { subjectId = null, conceptIds = [] } = {}) {
  let currentSubjectId = subjectId || null;
  let currentUnitId = inferInitialUnitId(classroom, conceptIds);
  let selectedConceptIds = new Set(conceptIds || []);

  return {
    getSubjectId: () => currentSubjectId,
    getUnitId: () => currentUnitId,
    getSelectedConceptIds: () => Array.from(selectedConceptIds),
    isConceptSelected: (conceptId) => selectedConceptIds.has(conceptId),
    getUnits: () => getUnitsForSubject(classroom, currentSubjectId),
    getConcepts: () => getConceptsForUnit(classroom, currentSubjectId, currentUnitId),

    /** A Subject change invalidates every existing Unit/Concept choice — neither is guaranteed to exist under the new Subject. */
    setSubjectId(nextSubjectId) {
      currentSubjectId = nextSubjectId || null;
      currentUnitId = null;
      selectedConceptIds = new Set();
    },

    /** A Unit change keeps only the selected concepts that actually belong to the new Unit (including clearing everything when the Unit is unset). */
    setUnitId(nextUnitId) {
      currentUnitId = nextUnitId || null;
      const validIds = new Set(getConceptsForUnit(classroom, currentSubjectId, currentUnitId).map((c) => c.id));
      selectedConceptIds = new Set(Array.from(selectedConceptIds).filter((id) => validIds.has(id)));
    },

    toggleConcept(conceptId, isSelected) {
      if (isSelected) selectedConceptIds.add(conceptId);
      else selectedConceptIds.delete(conceptId);
    },
  };
}
