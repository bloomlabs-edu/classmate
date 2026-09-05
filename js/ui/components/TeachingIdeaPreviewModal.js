/**
 * ui/components/TeachingIdeaPreviewModal.js
 *
 * "Understand what you're copying before you insert it" — one modal
 * for every element type (Spark / Activity / Question / Assessment /
 * Differentiation) plus a whole Teaching Idea lesson, following the
 * exact same shape ui/components/ImportPreviewModal.js already
 * established for this app's closest precedent: render a read-only
 * preview, Cancel or confirm, nothing mutates until the explicit
 * confirm button.
 *
 * `onCopy` is OPTIONAL — when omitted, this is pure discovery/preview
 * (ui/views/ConceptWorkspaceView.js's own Teaching Ideas tab: "This is
 * discovery/preview only. Insertion into the current lesson belongs in
 * the Builder," per explicit Phase 4 product direction) and only a
 * Close button shows. When provided (opened from
 * ui/views/LessonPlanBuilderView.js's own "+ From Teaching Ideas"
 * pickers), a "Copy to Lesson" button appears too.
 */

import { renderReadOnlyField, renderReadOnlyActivityCard, renderSourceAttribution } from './LessonContentReadOnly.js';

const ELEMENT_TYPE_LABELS = Object.freeze({
  spark: 'Spark',
  activity: 'Activity',
  question: 'Question',
  assessment: 'Assessment Idea',
  differentiation: 'Differentiation',
});

const BUCKET_LABELS = Object.freeze({ redBucket: 'Red Bucket', greenBucket: 'Green Bucket', others: 'Others' });

function renderElementBody(element) {
  const body = document.createElement('div');
  body.className = 'teaching-idea-preview__body';

  if (element.elementType === 'spark' || element.elementType === 'activity') {
    body.appendChild(renderReadOnlyActivityCard(element.content));
  } else if (element.elementType === 'question' || element.elementType === 'assessment') {
    body.appendChild(renderReadOnlyField(ELEMENT_TYPE_LABELS[element.elementType], element.content));
  } else if (element.elementType === 'differentiation') {
    body.appendChild(renderReadOnlyField(BUCKET_LABELS[element.bucket] || 'Differentiation', element.content));
  }

  return body;
}

/** `element` is one of services/teachingIdeasService.js's own extractElements() outputs. */
export function openTeachingIdeaElementPreview({ element, onCopy, onCancel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Preview Teaching Idea');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = element.title || ELEMENT_TYPE_LABELS[element.elementType];
  modal.appendChild(heading);

  const typeTag = document.createElement('span');
  typeTag.className = 'teaching-idea-preview__type-tag';
  typeTag.textContent = ELEMENT_TYPE_LABELS[element.elementType] || element.elementType;
  modal.appendChild(typeTag);

  modal.appendChild(renderElementBody(element));
  modal.appendChild(renderSourceAttribution(element.sourceContext));

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  if (onCopy) {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'btn btn--primary';
    copyButton.textContent = 'Copy to Lesson';
    copyButton.addEventListener('click', () => {
      close();
      onCopy(element);
    });
    actions.appendChild(copyButton);
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.textContent = onCopy ? 'Cancel' : 'Close';
  closeButton.addEventListener('click', () => {
    close();
    onCancel?.();
  });
  actions.appendChild(closeButton);

  modal.appendChild(actions);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
      onCancel?.();
    }
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/** A complete Teaching Idea lesson — coherent structure (Why / Self·Others·India / Assessment / Spark+Activities / Helping Each Other Learn), read-only, no comment affordances, no review actions (this is a historical, already-approved lesson being browsed for inspiration, not something under review). `teachingIdea` is one of repositories/teachingIdeasRepository.js's own projection documents. */
export function openTeachingIdeaLessonPreview({ teachingIdea, onCancel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Preview Lesson Example');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = teachingIdea.topic || 'Untitled Lesson Plan';
  modal.appendChild(heading);

  modal.appendChild(renderSourceAttribution(teachingIdea));

  const body = document.createElement('div');
  body.className = 'teaching-idea-preview__lesson-body';

  body.appendChild(renderReadOnlyField('Lesson Objective', teachingIdea.lessonObjective));
  body.appendChild(renderReadOnlyField('Big Question', teachingIdea.bigQuestion));
  body.appendChild(renderReadOnlyField('Self', teachingIdea.selfOthersIndia?.self));
  body.appendChild(renderReadOnlyField('Others', teachingIdea.selfOthersIndia?.others));
  body.appendChild(renderReadOnlyField('India', teachingIdea.selfOthersIndia?.india));

  teachingIdea.assessments.forEach((item, index) => body.appendChild(renderReadOnlyField(`Assessment ${index + 1}`, item.description)));

  const sparkHeading = document.createElement('h3');
  sparkHeading.className = 'teaching-idea-preview__subheading';
  sparkHeading.textContent = 'Spark';
  body.appendChild(sparkHeading);
  body.appendChild(renderReadOnlyActivityCard(teachingIdea.spark));

  const activitiesHeading = document.createElement('h3');
  activitiesHeading.className = 'teaching-idea-preview__subheading';
  activitiesHeading.textContent = 'Learning Activities';
  body.appendChild(activitiesHeading);
  teachingIdea.activities.forEach((activity) => body.appendChild(renderReadOnlyActivityCard(activity)));

  body.appendChild(renderReadOnlyField('Pair Explanation', teachingIdea.pairExplanation));
  body.appendChild(renderReadOnlyField('Final Question', teachingIdea.finalQuestion));
  body.appendChild(renderReadOnlyField('Teacher Look-Fors', teachingIdea.teacherLookFors));

  modal.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => {
    close();
    onCancel?.();
  });
  actions.appendChild(closeButton);
  modal.appendChild(actions);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
      onCancel?.();
    }
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
