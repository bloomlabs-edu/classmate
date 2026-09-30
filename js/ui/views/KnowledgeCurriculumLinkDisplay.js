/**
 * ui/views/KnowledgeCurriculumLinkDisplay.js
 *
 * ClassMate Knowledge Model — K3, the first real consumer. Pure,
 * Firestore-free matching/display logic for enriching Curriculum
 * Management's existing "Preview Structure" screen (see
 * ui/views/CurriculumManagementView.js's own renderPreviewStructureStep())
 * with a read-only view of any KnowledgeConcepts a Program Manager has
 * already authored FROM one of that Unit's own textbook items, via
 * ui/views/KnowledgeTextbookReviewView.js (K2.4).
 *
 * Kept in its own dependency-free file for the same reason
 * ui/views/KnowledgeAuthoringDisplay.js and ui/views/MyWorkTaskDisplay.js
 * already exist: the real view (ui/views/CurriculumManagementView.js)
 * transitively imports Firestore-touching repositories, which crashes
 * under plain `node --test`; this one set of decisions needs to stay
 * directly unit-testable.
 *
 * ---------------------------------------------------------------------
 * The join: sourceCurriculumUnitId === unit.id, then exact title match
 * ---------------------------------------------------------------------
 *
 * Per the K3.0 architecture investigation: a published Curriculum
 * Pack's own `unit.id` is NOT the random draft-session id — it's
 * `slugify(unit.title)` (see services/curriculumReviewService.js's own
 * exportPackJson()/slugify()), computed fresh every time a curriculum
 * is authored/published. `sourceCurriculumUnitId` on a KnowledgeConcept
 * (set by K2.4's Textbook Review) is exactly this same id. Matching a
 * Unit's own OWN textbook item (a plain title string in
 * `unit.concepts[]`, never itself possessing a stable id) back to the
 * ONE KnowledgeConcept that was authored from it therefore requires
 * TWO conditions, both exact, never fuzzy or semantic:
 *   1. `concept.sourceCurriculumUnitId === unit.id`
 *   2. `concept.title` matches the textbook item's own title exactly
 *      (case/whitespace-insensitive only — the same convention
 *      ui/views/KnowledgeAuthoringDisplay.js's own
 *      findConceptByExactTitle() already establishes for K2.1/K2.4).
 *
 * ---------------------------------------------------------------------
 * ACCEPTED LIMITATION — title-slug provenance, not a stable identifier
 * ---------------------------------------------------------------------
 *
 * Because the join key is ultimately derived from TITLE TEXT (both the
 * Unit's own id, via slugify(), and the per-item match, via exact
 * title comparison), this enrichment will silently stop matching if:
 *   - a Curriculum Unit is ever retitled and republished under a
 *     mechanism that changes its own `unit.id` (no such mechanism is
 *     reachable through any live UI today — see the K3.0 report — but
 *     the export pipeline itself would produce a new id if it existed);
 *   - a Program Manager edits a Concept's own title, in K2.4's "Create
 *     New Concept" form, away from the textbook item's original
 *     wording (that form pre-fills but explicitly allows editing).
 * Both are EXPLICITLY ACCEPTED for K3, per direct product decision —
 * `sourceCurriculumUnitId` remains provenance-only (see
 * models/KnowledgeConcept.js's own header comment) and this file
 * introduces NO new stable identifier to work around either case. A
 * Concept that no longer matches simply produces no enrichment for
 * that textbook item — identical, visually, to a textbook item that
 * was never reviewed at all (see buildUnitKnowledgeEnrichment()'s own
 * comment below).
 *
 * ---------------------------------------------------------------------
 * Direct relationships only — never recursive, never a graph traversal
 * ---------------------------------------------------------------------
 *
 * findDirectRelationshipsForConcept() and buildRelationshipDisplayLines()
 * below only ever look at relationships where the matched Concept
 * itself is `fromConceptId` or `toConceptId` — one hop, always. Neither
 * function, nor anything else in this file, ever follows a resolved
 * "other Concept" onward to ITS OWN relationships. There is no queue,
 * no visited-set, no recursion of any kind here — by construction, not
 * merely by convention.
 */

import { getRelationshipForwardLabel, getReverseRelationshipLabel } from '../../models/KnowledgeRelationship.js';

/** One Concept's own title by id, or null (never a placeholder string) — used only to resolve the OTHER side of a relationship for display; a relationship whose other Concept no longer resolves is simply dropped by buildRelationshipDisplayLines() below, never shown broken. */
function resolveConceptTitle(concepts, conceptId) {
  const concept = (concepts || []).find((c) => c.id === conceptId);
  return concept ? concept.title : null;
}

/** Every KnowledgeConcept authored FROM this exact Curriculum Unit — the first half of K3's join, `sourceCurriculumUnitId === unitId`. An empty/undefined `allConcepts` degrades safely to an empty array. */
export function findKnowledgeConceptsForUnit(allConcepts, unitId) {
  if (!unitId) return [];
  return (allConcepts || []).filter((concept) => concept.sourceCurriculumUnitId === unitId);
}

/**
 * The ONE KnowledgeConcept (or null) that corresponds to this specific
 * textbook item — both halves of the join (unit id, then exact title)
 * applied together. Exact, case/whitespace-insensitive comparison
 * only, matching ui/views/KnowledgeAuthoringDisplay.js's own
 * findConceptByExactTitle() convention — never a fuzzy or semantic
 * match, and never a guess when more than one Concept from the same
 * Unit happens to share the exact same title (the first exact match
 * wins, same "don't invent a tie-break policy the evidence doesn't
 * require" posture as everywhere else in this feature).
 */
export function findKnowledgeConceptForTextbookItem(allConcepts, { unitId, itemTitle }) {
  const trimmedTitle = (itemTitle || '').trim().toLowerCase();
  if (!trimmedTitle) return null;
  return findKnowledgeConceptsForUnit(allConcepts, unitId).find((concept) => concept.title.trim().toLowerCase() === trimmedTitle) || null;
}

/** Every KnowledgeRelationship directly touching this one Concept id — as either its `fromConceptId` or `toConceptId`. ONE hop only; see this file's own header comment on why nothing here ever traverses further. */
export function findDirectRelationshipsForConcept(allRelationships, conceptId) {
  if (!conceptId) return [];
  return (allRelationships || []).filter((relationship) => relationship.fromConceptId === conceptId || relationship.toConceptId === conceptId);
}

/**
 * Display-ready lines for every direct relationship touching
 * `conceptId` — e.g. for the stored fact "Heavy rainfall CAUSES Flood",
 * Flood's own line reads "is caused by Heavy rainfall" (the DERIVED
 * reverse reading, via models/KnowledgeRelationship.js's own
 * getReverseRelationshipLabel() — never re-implemented here, never
 * independently stored, per that file's own frozen design), while
 * Heavy rainfall's own line would read "causes Flood" (the forward
 * reading, via getRelationshipForwardLabel()). Direction is decided
 * purely by which side of the stored relationship `conceptId` is on.
 * A relationship whose OTHER Concept no longer resolves to a real
 * title is skipped entirely, never rendered as a broken/blank line.
 */
export function buildRelationshipDisplayLines(allRelationships, conceptId, allConcepts) {
  return findDirectRelationshipsForConcept(allRelationships, conceptId)
    .map((relationship) => {
      const isForward = relationship.fromConceptId === conceptId;
      const otherConceptId = isForward ? relationship.toConceptId : relationship.fromConceptId;
      const otherConceptTitle = resolveConceptTitle(allConcepts, otherConceptId);
      if (!otherConceptTitle) return null;
      const label = isForward ? getRelationshipForwardLabel(relationship.type) : getReverseRelationshipLabel(relationship.type);
      return { relationshipId: relationship.id, otherConceptId, otherConceptTitle, text: `${label} ${otherConceptTitle}` };
    })
    .filter(Boolean);
}

/**
 * Everything ui/components/CurriculumExplorerPanel.js needs to render
 * for ONE textbook item, or null if this item has no matching
 * KnowledgeConcept at all — the one place "should this item show a
 * Knowledge Model block" is decided. Returning null here (rather than
 * an empty-but-present object) is what lets the caller render an
 * unreviewed item exactly as it renders today, with no placeholder
 * text of any kind (see this feature's own explicit "do not add noise
 * to unreviewed curriculum" requirement).
 */
export function buildTextbookItemEnrichment(allConcepts, allRelationships, { unitId, itemTitle }) {
  const concept = findKnowledgeConceptForTextbookItem(allConcepts, { unitId, itemTitle });
  if (!concept) return null;
  return {
    conceptId: concept.id,
    conceptTitle: concept.title,
    relationshipLines: buildRelationshipDisplayLines(allRelationships, concept.id, allConcepts),
  };
}

/**
 * Every textbook item in `unit.concepts[]` that has a matching
 * KnowledgeConcept, keyed by the item's own title string (the exact
 * same string ui/views/CurriculumManagementView.js's own
 * renderPreviewStructureStep() already uses as that concept's `id` in
 * the shape it hands ui/components/CurriculumExplorerPanel.js — see
 * that view's own `concepts: unit.concepts.map((conceptTitle) =>
 * ({id: conceptTitle, title: conceptTitle}))`). An item with no match
 * is simply absent from the returned object — never a `null`/empty
 * placeholder entry — so the caller's own "does this key exist" check
 * is the entire decision of whether to render anything extra.
 */
export function buildUnitKnowledgeEnrichment(unit, allConcepts, allRelationships) {
  const byItemTitle = {};
  (unit?.concepts || []).forEach((itemTitle) => {
    const enrichment = buildTextbookItemEnrichment(allConcepts, allRelationships, { unitId: unit.id, itemTitle });
    if (enrichment) byItemTitle[itemTitle] = enrichment;
  });
  return byItemTitle;
}
