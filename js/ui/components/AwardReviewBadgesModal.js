/**
 * ui/components/AwardReviewBadgesModal.js
 *
 * "Award a badge?" — opened from ui/views/NotebookCheckpointsView.js
 * immediately after a review is marked 'complete' (never merely
 * 'submitted' — see services/notebookBadgeAwardService.js's own header
 * comment on why those triggers are kept separate), the one moment
 * Organization and Punctuation Champion are ever offered. Never opens
 * on its own initiative and owns no service calls itself — mirrors
 * ui/components/LearningHubConceptMappingModal.js's own "this file only
 * owns the prompt UI, the caller owns persistence" split, and shares
 * the exact modal shell ui/components/AddNotebookBadgeTypeModal.js
 * already established (modal-overlay/modal/modal__heading/
 * modal__actions, btn--primary/btn--text).
 *
 * `badges` — an array of { id, name, alreadyAwarded } describing
 * exactly which badge types this prompt offers right now (the caller
 * resolves `alreadyAwarded` from the real submission record before
 * opening this, via notebookBadgeAwardService.hasActiveBadgeAward()).
 * `onAward(badgeTypeId)` is the caller's own synchronous function,
 * returning `true` on a real award (the button locks to "Awarded ✓")
 * or `false` on failure (the button re-enables so the teacher can
 * retry) — same success/failure contract AddNotebookBadgeTypeModal.js's
 * own onSave already uses.
 *
 * Deliberately has no Save/Cancel pair: each award is its own
 * immediate, independent action (exactly like
 * ui/views/NotebookCheckpointsView.js's own onQuickReview quick
 * action), not a batch of pending edits — so this modal only ever
 * offers one "Close" action once a teacher is done.
 */
export function openAwardReviewBadgesModal({ studentName, checkpointTitle, badges, onAward }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Award a badge');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Review marked Complete — award a badge?';

  const subheading = document.createElement('p');
  subheading.className = 'missionCaption';
  subheading.textContent = `${studentName} — "${checkpointTitle}"`;

  const form = document.createElement('div');
  form.className = 'modal__form award-review-badges__list';

  badges.forEach((badge) => {
    const row = document.createElement('div');
    row.className = 'award-review-badges__row';

    const label = document.createElement('span');
    label.className = 'award-review-badges__name';
    label.textContent = badge.name;
    row.appendChild(label);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary';

    function setAwardedState() {
      button.textContent = 'Awarded ✓';
      button.disabled = true;
    }

    if (badge.alreadyAwarded) {
      setAwardedState();
    } else {
      button.textContent = 'Award';
    }

    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Awarding…';
      const succeeded = onAward(badge.id);
      if (succeeded) {
        setAwardedState();
      } else {
        button.disabled = false;
        button.textContent = 'Award';
      }
    });

    row.appendChild(button);
    form.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.textContent = 'Close';

  function close() {
    overlay.remove();
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.appendChild(closeButton);
  modal.append(heading, subheading, form, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
