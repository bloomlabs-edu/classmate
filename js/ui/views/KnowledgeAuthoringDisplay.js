/**
 * ui/views/KnowledgeAuthoringDisplay.js
 *
 * Pure display/lookup logic for ui/views/KnowledgeConceptsView.js,
 * ui/views/KnowledgeRelationshipsView.js,
 * ui/views/KnowledgeClassificationsView.js,
 * ui/views/KnowledgeTextbookReviewView.js, and
 * ui/components/KnowledgeConceptPicker.js — kept in its own
 * dependency-free file for the same reason ui/views/MyWorkTaskDisplay.js
 * exists: the real views transitively import Firestore-touching
 * repositories, which crashes under plain `node --test`; this one set
 * of decisions needs to stay directly unit-testable.
 *
 * Deliberately SUBSTRING matching only, never fuzzy/similarity-based —
 * see this feature's own K2 design report: "never auto-merge or
 * auto-select a concept solely because of title similarity." A human
 * always makes the reuse-vs-create call; this file only narrows what
 * they see while deciding, it never decides for them.
 */

import { getRelationshipForwardLabel, getReverseRelationshipLabel } from '../../models/KnowledgeRelationship.js';

/** Every KnowledgeConcept whose title contains `query` (case-insensitive), for the plain browsing list/search — not the picker's own dropdown, which uses ui/components/SearchableSelect.js's identical substring logic directly. An empty/blank query returns every concept, unfiltered. */
export function filterConceptsByQuery(concepts, query) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return concepts || [];
  return (concepts || []).filter((concept) => concept.title.toLowerCase().includes(trimmed));
}

/** `{value, label}` pairs for ui/components/SearchableSelect.js — `value` is the Concept's own stable id, never its title, so a rename never silently breaks a reference some other record already stored. Sorted alphabetically by title so the dropdown reads predictably regardless of Firestore's own document-return order. */
export function buildConceptPickerOptions(concepts) {
  return (concepts || [])
    .map((concept) => ({ value: concept.id, label: concept.title }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One Concept's own title by id, or a visible, honest placeholder
 * (never a blank string, never a thrown error) — a relationship
 * referencing a Concept that's since been deleted should still render
 * as a readable row, not disappear or crash the whole list.
 */
function resolveConceptTitle(concepts, conceptId) {
  const concept = (concepts || []).find((c) => c.id === conceptId);
  return concept ? concept.title : '(unknown Concept)';
}

/**
 * One KnowledgeRelationship, resolved into everything
 * ui/views/KnowledgeRelationshipsView.js's own list row needs to render
 * WITHOUT re-deriving any of it itself: real Concept titles (not bare
 * ids), the forward reading (getRelationshipForwardLabel — K1's own
 * helper, read here, never reimplemented), and the reverse reading
 * (getReverseRelationshipLabel) as a full, grammatical sentence from
 * the `toConceptId` Concept's own point of view — e.g. "Flood is
 * caused by Heavy rainfall" for a stored "Heavy rainfall CAUSES Flood"
 * fact. Nothing about the reverse sentence is stored anywhere; it is
 * recomputed every time this function runs, per K1's own frozen design
 * ("reverse relationships are derived, never independently stored").
 */
function buildRelationshipRow(relationship, concepts) {
  const fromTitle = resolveConceptTitle(concepts, relationship.fromConceptId);
  const toTitle = resolveConceptTitle(concepts, relationship.toConceptId);
  return {
    id: relationship.id,
    fromConceptId: relationship.fromConceptId,
    toConceptId: relationship.toConceptId,
    type: relationship.type,
    fromTitle,
    toTitle,
    forwardLabel: getRelationshipForwardLabel(relationship.type),
    reverseSentence: `${toTitle} ${getReverseRelationshipLabel(relationship.type)} ${fromTitle}`,
  };
}

/** Every KnowledgeRelationship, resolved into display rows (see buildRelationshipRow() above) — the one place ui/views/KnowledgeRelationshipsView.js turns raw `{fromConceptId,toConceptId,type}` facts into something readable. */
export function buildRelationshipRows(relationships, concepts) {
  return (relationships || []).map((relationship) => buildRelationshipRow(relationship, concepts));
}

/** Filters already-built relationship rows (see buildRelationshipRows() above) by a plain, case-insensitive substring match against either Concept's own title or the relationship's forward label — same "never fuzzy" convention as filterConceptsByQuery() above. An empty/blank query returns every row, unfiltered. */
export function filterRelationshipRowsByQuery(rows, query) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return rows || [];
  return (rows || []).filter(
    (row) => row.fromTitle.toLowerCase().includes(trimmed) || row.toTitle.toLowerCase().includes(trimmed) || row.forwardLabel.toLowerCase().includes(trimmed)
  );
}

/**
 * Whether a relationship TYPE reads identically in both directions
 * (RELATED_TO, CONTRASTS_WITH) — derived directly from K1's own
 * getRelationshipForwardLabel()/getReverseRelationshipLabel() rather
 * than a second, hand-maintained list of "which types are symmetric"
 * that could drift out of sync with models/KnowledgeRelationship.js's
 * own label map. Used only by findDuplicateRelationship() below.
 */
export function isSymmetricRelationshipType(type) {
  return getRelationshipForwardLabel(type) === getReverseRelationshipLabel(type);
}

/**
 * The one existing relationship this exact {fromConceptId, toConceptId,
 * type} triple would duplicate, or null. For a SYMMETRIC type (see
 * isSymmetricRelationshipType() above), also catches the same fact
 * already stored in the opposite direction — "Flood RELATED_TO Hazard"
 * and "Hazard RELATED_TO Flood" assert the identical claim, so creating
 * the second is a duplicate even though its own fromConceptId/
 * toConceptId are swapped. For an ASYMMETRIC type (CAUSES, IS_A, ...),
 * only the exact same direction counts as a duplicate — "Flood CAUSES
 * Heavy rainfall" is a different (and contradictory) claim from "Heavy
 * rainfall CAUSES Flood," never a duplicate of it. Does not require any
 * new repository query — evaluated entirely over the already-loaded
 * full relationships list (see repositories/knowledgeRelationshipRepository.js's
 * own getAllKnowledgeRelationships()), the exact same "one query,
 * filter client-side" convention every other K1 repository already
 * uses.
 */
export function findDuplicateRelationship(relationships, { fromConceptId, toConceptId, type }) {
  const symmetric = isSymmetricRelationshipType(type);
  return (
    (relationships || []).find((existing) => {
      if (existing.type !== type) return false;
      const sameDirection = existing.fromConceptId === fromConceptId && existing.toConceptId === toConceptId;
      const reverseDirection = symmetric && existing.fromConceptId === toConceptId && existing.toConceptId === fromConceptId;
      return sameDirection || reverseDirection;
    }) || null
  );
}

// ---------------------------------------------------------------------
// Classifications / Categories / Memberships (K2.3)
// ---------------------------------------------------------------------

/**
 * One Classification, resolved into everything
 * ui/views/KnowledgeClassificationsView.js's own card needs to render:
 * its own Categories, each carrying the real Concepts CURRENTLY
 * assigned to it (via a KnowledgeClassificationMembership — see
 * models/KnowledgeClassificationMembership.js's own header comment).
 * Deliberately never filters out an empty Category (zero assigned
 * Concepts) or a Classification with zero Categories at all — both are
 * valid, real states the UI must still show (K2.3 requirements 7-8),
 * not something this function should hide.
 *
 * This is presentation-only nesting, never ownership: a Category here
 * is exactly the same plain `{id, name}` object
 * models/KnowledgeClassification.js's own `categories[]` array holds —
 * nothing about a Concept's own record changes shape by appearing
 * inside one of these; see this whole feature's own K1 design report
 * for why a Category must never become a Concept's structural parent.
 */
export function buildClassificationBlocks(classifications, memberships, concepts) {
  return (classifications || []).map((classification) => {
    const categories = (classification.categories || []).map((category) => {
      const categoryMemberships = (memberships || []).filter(
        (membership) => membership.classificationId === classification.id && membership.categoryId === category.id
      );
      const assignedConcepts = categoryMemberships.map((membership) => ({
        membershipId: membership.id,
        conceptId: membership.conceptId,
        title: resolveConceptTitle(concepts, membership.conceptId),
      }));
      return { id: category.id, name: category.name, assignedConcepts };
    });
    return { id: classification.id, name: classification.name, description: classification.description, categories };
  });
}

/** `{value, label}` pairs for a plain `<select>` of one Classification's own Categories — never sorted (unlike buildConceptPickerOptions() above): Category order is this Classification's own authored array order (see models/KnowledgeClassification.js's own header comment — "order is array position"), which the author may have chosen deliberately (e.g. Natural before Human-made before Socio-natural). An empty/missing Classification degrades safely to an empty array. */
export function buildCategoryOptions(classification) {
  return (classification?.categories || []).map((category) => ({ value: category.id, label: category.name }));
}

/**
 * The ONE existing KnowledgeClassificationMembership already placing
 * this Concept somewhere within this Classification, or null — the
 * entire enforcement mechanism behind K2.3's own policy: "a Concept may
 * have AT MOST ONE membership within a given Classification." Scoped
 * strictly to `classificationId` — a membership for the SAME Concept
 * under a DIFFERENT Classification is correctly ignored here (see this
 * file's own findDuplicateRelationship() for the analogous "scope the
 * check to the right key" reasoning), which is exactly what lets a
 * Concept belong to Categories under different Classifications at once
 * (K2.3 requirement 6). Evaluated entirely over the already-loaded full
 * memberships list — no new repository query, no schema change.
 */
export function findMembershipForConceptInClassification(memberships, { conceptId, classificationId }) {
  return (memberships || []).find((membership) => membership.conceptId === conceptId && membership.classificationId === classificationId) || null;
}

// ---------------------------------------------------------------------
// Textbook Review (K2.4) — deciding whether a textbook item is a real
// KnowledgeConcept or presentation-only, never inferring it
// ---------------------------------------------------------------------

/**
 * A NEW array of this Curriculum Unit's own item titles — never the
 * same array reference as `unit.concepts`, so nothing downstream can
 * ever mutate the real curriculum data by touching what this function
 * returns. Read-only in the fullest sense: never assigns to `unit` or
 * any of its own properties, only reads `unit.concepts`. Mirrors
 * services/curriculumLibraryService.js's own getUnitAsImportCandidate()
 * (which this file deliberately does NOT import — that service
 * transitively touches localStorage via
 * services/curriculumSubmissionsService.js, which would make this
 * whole file untestable under plain `node --test`; the real view layer
 * calls the real service and hands this function only the one plain
 * `unit` object it already resolved).
 */
export function extractTextbookItemTitles(unit) {
  return [...(unit?.concepts || [])];
}

/**
 * The starting per-item review state for a freshly-opened Unit — every
 * item begins 'undecided' (none of the three choices made yet). A
 * plain array, positionally aligned with extractTextbookItemTitles()'s
 * own output — index is this session's own identity for an item, not
 * the title string itself, so two textbook items that happen to share
 * an identical title are still tracked independently (a real published
 * pack's own `unit.concepts[]` carries no per-item id of its own to key
 * by instead — see this file's own header comment on why title-only
 * identity is inherently fragile).
 */
export function createInitialTextbookItemStates(titles) {
  return (titles || []).map((title) => ({ title, status: 'undecided', conceptId: null, conceptLabel: null }));
}

/**
 * An immutable update — returns a NEW array with the item at `index`
 * merged with `updates`, every other item untouched by reference. The
 * one place ui/views/KnowledgeTextbookReviewView.js changes an item's
 * own review decision, for all three choices alike:
 *   - "Leave as Heading": `{ status: 'heading' }` — no Concept id at
 *     all, since nothing was created or linked.
 *   - "Use Existing Concept": `{ status: 'existing', conceptId,
 *     conceptLabel }`.
 *   - "Create New Concept": `{ status: 'created', conceptId,
 *     conceptLabel }` — set only AFTER the real
 *     createKnowledgeConcept()/saveKnowledgeConcept() call the view
 *     layer itself makes; this function never creates anything, it
 *     only records that something already has been.
 */
export function setTextbookItemState(itemStates, index, updates) {
  return (itemStates || []).map((item, i) => (i === index ? { ...item, ...updates } : item));
}

/**
 * The one existing KnowledgeConcept whose title matches `title`
 * EXACTLY (case-insensitive), or null — the same "an exact spelling
 * match is a hard signal, not a fuzzy guess" rule
 * ui/components/SearchableSelect.js's own dropdown already enforces for
 * K2.1's Concepts screen (an exact match there suppresses "+ Create new
 * Concept" entirely). "Create New Concept" on this screen is a
 * SEPARATE button, not routed through that dropdown at all, so this
 * function is what gives it the same protection: block, don't silently
 * redirect, and never treat a near-miss ("Cyclonic storms" vs.
 * "Tropical cyclones") as a match — only a true exact spelling
 * collision counts.
 */
export function findConceptByExactTitle(concepts, title) {
  const trimmed = (title || '').trim().toLowerCase();
  if (!trimmed) return null;
  return (concepts || []).find((concept) => concept.title.trim().toLowerCase() === trimmed) || null;
}
