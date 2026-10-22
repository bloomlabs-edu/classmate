/**
 * ui/components/QuickRecognitionModal.js
 *
 * The quick-access affordance "Recognition, comments, and testimonials"
 * adds next to a student's row on a specific notebook/assignment work
 * item — opened via a small "Recognize" button
 * (ui/components/NotebookRoster.js's own rows; the Assignment Checkpoint
 * grid wires the identical modal the same way). One place a teacher can,
 * in a single action, for ONE student on ONE work item:
 *   - award one or more badges from the classroom's existing badge
 *     catalog (see services/badgeService.js/config/badgeConfig.js —
 *     reused as-is, never a second badge system),
 *   - optionally attach a short PRIVATE comment (see
 *     services/commentService.js — never published automatically),
 *   - optionally award an extra MANUAL completion star, independent of
 *     the automatic one already awarded for submitting.
 *
 * Rendering + wiring only — the caller supplies `onSubmit` and closes/
 * re-renders itself afterwards, matching ui/components/AwardBadgeModal.js's
 * own established convention. Deliberately a SEPARATE component from
 * AwardBadgeModal.js, not a rewrite of it — that modal's own single-pick
 * "award or create one badge" shape is still exactly right for the
 * Achievements tab's own "+ Award Badge" control, and changing its
 * behavior to support multi-select + a comment field would have altered
 * that existing, unrelated flow.
 */

export function openQuickRecognitionModal({ studentName, workItemLabel, availableBadges, onSubmit }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Recognize Student');

  function close() {
    overlay.remove();
  }

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = `Recognize ${studentName}`;

  const subheading = document.createElement('p');
  subheading.className = 'profile-section__meta';
  subheading.textContent = workItemLabel;

  const body = document.createElement('div');
  body.className = 'modal__form quick-recognition-modal__form';

  // --- Badges (0 or more) ---------------------------------------
  const badgeFieldset = document.createElement('fieldset');
  badgeFieldset.className = 'quick-recognition-modal__badges';
  const badgeLegend = document.createElement('legend');
  badgeLegend.className = 'modal__label';
  badgeLegend.textContent = 'Award a badge';
  badgeFieldset.appendChild(badgeLegend);

  const badgeCheckboxes = [];
  if (availableBadges.length === 0) {
    const noneMessage = document.createElement('p');
    noneMessage.className = 'profile-section__meta';
    noneMessage.textContent = 'This student already has every badge in the catalog.';
    badgeFieldset.appendChild(noneMessage);
  } else {
    availableBadges.forEach((badgeName) => {
      const option = document.createElement('label');
      option.className = 'quick-recognition-modal__badge-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = badgeName;
      badgeCheckboxes.push(checkbox);
      option.append(checkbox, document.createTextNode(` ${badgeName}`));
      badgeFieldset.appendChild(option);
    });
  }
  body.appendChild(badgeFieldset);

  // --- Manual star --------------------------------------------------
  const starLabel = document.createElement('label');
  starLabel.className = 'quick-recognition-modal__star-option';
  const starCheckbox = document.createElement('input');
  starCheckbox.type = 'checkbox';
  starLabel.append(starCheckbox, document.createTextNode(' Award an extra star for this'));
  body.appendChild(starLabel);

  // --- Private comment ------------------------------------------
  const commentLabel = document.createElement('label');
  commentLabel.className = 'modal__label';
  commentLabel.textContent = 'Private comment (optional — only authorized teachers can see this)';
  const commentInput = document.createElement('textarea');
  commentInput.className = 'modal__input quick-recognition-modal__comment-input';
  commentInput.rows = 3;
  commentInput.placeholder = 'e.g. Worked especially carefully on the diagrams today.';
  commentLabel.appendChild(commentInput);
  body.appendChild(commentLabel);

  const privacyNote = document.createElement('p');
  privacyNote.className = 'profile-section__meta quick-recognition-modal__privacy-note';
  privacyNote.textContent = 'This comment stays private. You can publish it as a testimonial later from the student’s profile.';
  body.appendChild(privacyNote);

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--ghost';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = 'Save';
  submitButton.addEventListener('click', () => {
    const badgeNames = badgeCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const text = commentInput.value.trim();
    close();
    onSubmit({
      badgeNames,
      awardManualStar: starCheckbox.checked,
      text: text || null,
    });
  });

  actions.append(cancelButton, submitButton);
  body.appendChild(actions);

  modal.append(heading, subheading, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
