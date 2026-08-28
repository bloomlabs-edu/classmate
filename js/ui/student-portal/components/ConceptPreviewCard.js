/**
 * ui/student-portal/components/ConceptPreviewCard.js
 *
 * Phase 5 — the one, shared "what is this concept, and can I revisit
 * it?" card, used in exactly two places per the approved dual-access
 * pattern: ui/student-portal/views/ConceptFeedbackFlowView.js renders
 * it ABOVE the feedback question (recall before answering) and BELOW
 * it (revisit after answering); ui/student-portal/views/StudentLearningView.js's
 * own Concept Detail level renders the same two calls around its own
 * reflection buttons. One implementation, two call sites — never a
 * second card built independently for either screen.
 *
 * Content shown, and exactly why nothing beyond this is fabricated:
 *   - `concept.title` — always.
 *   - `concept.description` — the short teacher-authored blurb added
 *     this phase (see models/LearningConcept.js's own doc comment).
 *     Omitted entirely (not a fake "no description" message) when a
 *     teacher hasn't written one yet — see renderConceptPreviewCard()'s
 *     own `showEmptyState` param for the one place that's shown as an
 *     honest empty state instead of nothing.
 *   - Student-visible 'external_link' resources with a real
 *     `content.url` — resolved via resourceService.getStudentVisibleResources(),
 *     the exact same audience-filtered read every other student
 *     surface already uses. Rendered as "Open resource" with the
 *     resource's own `content.description` if present.
 *   - Nothing else: per this phase's own data-model audit, 'image' and
 *     every other RESOURCE_TYPE_KEYS entry besides 'reading' and
 *     'external_link' has no populated `content` shape anywhere in
 *     this app yet (no upload/editor exists for them) — showing a
 *     bare, action-less "Image" or "Video" card would be clutter, not
 *     a real reference, so those are simply skipped here rather than
 *     invented. This is the exact, current data-model gap, reported
 *     rather than papered over — see this phase's own final report.
 */

import * as resourceService from '../../../services/resourceService.js';
import { createIcon } from '../../components/Icon.js';

/**
 * Fetches this concept's student-visible resources and narrows them
 * to the ones this card actually knows how to render — today, only a
 * real, non-empty 'external_link'. Kept as its own function so both
 * call sites below share one, single "what counts as revisitable
 * reference material" decision.
 */
async function getRenderableReferenceResources(classroomId, concept) {
  const resources = await resourceService.getStudentVisibleResources(classroomId, concept);
  return resources.filter((resource) => resource.type === 'external_link' && resource.content?.url);
}

function renderResourceRow(resource) {
  const row = document.createElement('div');
  row.className = 'concept-preview-card__resource';

  if (resource.content?.description) {
    const description = document.createElement('p');
    description.className = 'concept-preview-card__resource-description';
    description.textContent = resource.content.description;
    row.appendChild(description);
  }

  const link = document.createElement('a');
  link.className = 'btn btn--secondary concept-preview-card__resource-link';
  link.href = resource.content.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(createIcon('arrow-right', { size: 14 }), ' Open resource');
  row.appendChild(link);

  return row;
}

/**
 * The card shown ABOVE the feedback question — recall before
 * answering. `showEmptyState`: StudentLearningView.js's Concept Detail
 * level always shows this card as the primary content for the
 * concept, so an honest "Your teacher hasn't added a description for
 * this concept yet." is shown there when there's no description;
 * ConceptFeedbackFlowView.js's per-lesson flow already shows the title
 * prominently in its own header immediately above this card, so it
 * defaults to omitting the card entirely rather than duplicating the
 * title when there's neither a description nor a resource to show.
 */
export function renderConceptPreviewCard(classroomId, concept, { showEmptyState = false, showTitle = false } = {}) {
  const card = document.createElement('div');
  card.className = 'concept-preview-card';

  const heading = document.createElement('p');
  heading.className = 'concept-preview-card__heading';
  heading.textContent = 'What did we learn?';
  card.appendChild(heading);

  if (showTitle) {
    const title = document.createElement('p');
    title.className = 'concept-preview-card__title';
    title.textContent = concept.title;
    card.appendChild(title);
  }

  if (concept.description) {
    const description = document.createElement('p');
    description.className = 'concept-preview-card__description';
    description.textContent = concept.description;
    card.appendChild(description);
  } else if (showEmptyState) {
    const emptyNote = document.createElement('p');
    emptyNote.className = 'concept-preview-card__description concept-preview-card__description--empty';
    emptyNote.textContent = "Your teacher hasn't added a description for this concept yet.";
    card.appendChild(emptyNote);
  }

  const resourceSlot = document.createElement('div');
  resourceSlot.className = 'concept-preview-card__resource-slot';
  card.appendChild(resourceSlot);
  getRenderableReferenceResources(classroomId, concept).then((resources) => {
    resources.forEach((resource) => resourceSlot.appendChild(renderResourceRow(resource)));
  });

  // Nothing at all to show (no description, no resource, empty state
  // not requested) — an empty card would just be visual noise above a
  // feedback prompt that already names the concept in its own header.
  if (!concept.description && !showEmptyState && !showTitle) {
    card.classList.add('concept-preview-card--pending-resources');
  }

  return card;
}

/**
 * The card shown BELOW the feedback options — revisit after
 * answering. Same content, different framing: this is explicitly the
 * "review" moment, not the "recall" moment, so it leads with a
 * 📚-badged "Review this concept" heading rather than repeating "What
 * did we learn?". Omits the description entirely when there is none
 * (never a fake description) and shows nothing at all — not even the
 * card shell — when there's neither a description nor a resource,
 * since an empty "Review this concept" card with nothing inside it
 * would be worse than no card.
 */
export function renderConceptReferenceCard(classroomId, concept) {
  const card = document.createElement('div');
  card.className = 'concept-preview-card concept-preview-card--reference';
  card.hidden = true; // revealed once we know there's actually something to show

  const heading = document.createElement('p');
  heading.className = 'concept-preview-card__heading';
  heading.append(createIcon('book-open', { size: 16 }), ' Review this concept');
  card.appendChild(heading);

  let hasContent = false;

  if (concept.description) {
    const description = document.createElement('p');
    description.className = 'concept-preview-card__description';
    description.textContent = concept.description;
    card.appendChild(description);
    hasContent = true;
  }

  const resourceSlot = document.createElement('div');
  resourceSlot.className = 'concept-preview-card__resource-slot';
  card.appendChild(resourceSlot);

  getRenderableReferenceResources(classroomId, concept).then((resources) => {
    resources.forEach((resource) => resourceSlot.appendChild(renderResourceRow(resource)));
    if (resources.length > 0) card.hidden = false;
  });

  if (hasContent) card.hidden = false;

  return card;
}
