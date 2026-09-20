/**
 * ui/components/SubmitLessonPlanWarningsModal.js
 *
 * "Submit without these?" — shown when a teacher clicks Submit/Resubmit
 * for Review on a Lesson Plan that still has incomplete checklist items
 * (see services/lessonPlanValidationService.js's own
 * getLessonPlanReadinessByStage()). Per explicit product direction, the
 * readiness checklist is advisory, never a hard gate — the only real
 * submission requirement is at least one Learning Activity (see that
 * same file's canSubmitLessonPlan()) — this modal exists purely to make
 * sure a teacher is choosing to submit past real, visible gaps on
 * purpose, not by accident. Follows the exact same modal-overlay
 * structure as ResetScoreboardModal.js.
 */

export function openSubmitLessonPlanWarningsModal({ isResubmit = false, warnings, onSubmitAnyway }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', isResubmit ? 'Resubmit without these?' : 'Submit without these?');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = isResubmit ? 'Resubmit without these?' : 'Submit without these?';

  const intro = document.createElement('p');
  intro.className = 'submit-warnings-modal__intro';
  intro.textContent = 'You can still submit this lesson plan, but these items are incomplete.';

  const groups = document.createElement('div');
  groups.className = 'submit-warnings-modal__groups';
  warnings.forEach(({ label, messages }) => {
    const group = document.createElement('div');
    group.className = 'submit-warnings-modal__group';

    const groupLabel = document.createElement('p');
    groupLabel.className = 'submit-warnings-modal__group-label';
    groupLabel.textContent = label;
    group.appendChild(groupLabel);

    const list = document.createElement('ul');
    list.className = 'submit-warnings-modal__list';
    messages.forEach((message) => {
      const item = document.createElement('li');
      item.textContent = message;
      list.appendChild(item);
    });
    group.appendChild(list);

    groups.appendChild(group);
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const submitAnywayButton = document.createElement('button');
  submitAnywayButton.type = 'button';
  submitAnywayButton.className = 'btn btn--primary';
  submitAnywayButton.textContent = 'Submit Anyway';
  submitAnywayButton.addEventListener('click', () => {
    close();
    onSubmitAnyway();
  });

  const goBackButton = document.createElement('button');
  goBackButton.type = 'button';
  goBackButton.className = 'btn btn--text';
  goBackButton.textContent = 'Go Back';
  goBackButton.addEventListener('click', close);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(submitAnywayButton, goBackButton);
  modal.append(heading, intro, groups, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
