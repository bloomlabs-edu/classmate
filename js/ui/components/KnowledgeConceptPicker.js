/**
 * ui/components/KnowledgeConceptPicker.js
 *
 * The one, shared "search existing KnowledgeConcepts, or deliberately
 * create a new one" affordance — built on the existing
 * ui/components/SearchableSelect.js rather than a new search UI, per
 * this feature's own K2 design report. K2.1 uses this from
 * ui/views/KnowledgeAuthoringView.js's own Concepts screen; a later
 * phase's Relationship/Classification-Membership authoring (K2.2/K2.3)
 * reuses this exact same component, not a second one.
 *
 * `onSelect(value, { label, isNew })` is passed straight through from
 * SearchableSelect — `isNew: false` means the human explicitly picked
 * an EXISTING Concept (`value` is that Concept's own id, from
 * KnowledgeAuthoringDisplay.buildConceptPickerOptions() below);
 * `isNew: true` means they explicitly picked "+ Create new Concept"
 * (`value`/`label` is the typed title text, no Concept exists for it
 * yet). This component never decides which happened beyond reporting
 * SearchableSelect's own flag — it never merges, never auto-selects by
 * similarity, and never creates anything itself; the caller (see
 * ui/views/KnowledgeConceptsView.js) is the one that actually calls
 * createKnowledgeConcept()/saveKnowledgeConcept() when isNew is true.
 *
 * `allowCustom` (default true, matching K2.1's own Concepts-screen
 * behavior) — pass `false` to disable the "+ Create new Concept"
 * affordance entirely, reusing SearchableSelect's own existing
 * `allowCustom: false` behavior rather than building a second, inline-
 * creation-free search component. ui/views/KnowledgeRelationshipsView.js
 * (K2.2) is the first caller to set this false: per that phase's own
 * explicit requirement, both endpoints of a Relationship must already
 * exist as real KnowledgeConcepts — a Relationship form is never a back
 * door for creating one inline.
 */

import { createSearchableSelect } from './SearchableSelect.js';
import { buildConceptPickerOptions } from '../views/KnowledgeAuthoringDisplay.js';

export function createKnowledgeConceptPicker({ concepts, onSelect, placeholder = 'Search existing Concepts…', allowCustom = true }) {
  return createSearchableSelect({
    options: buildConceptPickerOptions(concepts),
    placeholder,
    onSelect,
    allowCustom,
    createLabel: (typed) => `+ Create new Concept: '${typed}'`,
  });
}
