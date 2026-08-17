/**
 * ui/components/ResetScoreboardModal.js
 *
 * The confirmation flow for the permanent Reset Scoreboard action —
 * deliberately a real modal with an explicit checklist, not a bare
 * window.confirm() (unlike the existing, lighter-weight "Reset
 * Session" action in ui/views/TrackerView.js), since this one is
 * permanent and cross-session. Follows the exact same modal-overlay
 * structure as AddNoteModal.js.
 */

export function openResetScoreboardModal({ onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Reset Scoreboard');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = 'Reset Scoreboard?';

  const intro = document.createElement('p');
  intro.className = 'reset-scoreboard-modal__intro';
  intro.textContent = 'This will:';

  const checklist = document.createElement('ul');
  checklist.className = 'reset-scoreboard-modal__checklist';
  [
    'Archive the current scoreboard permanently',
    'Start a new scoring period',
    'Reset all individual scores to 0',
    'Reset all group totals to 0',
    'Keep all students and groups unchanged',
  ].forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    checklist.appendChild(item);
  });

  const warning = document.createElement('p');
  warning.className = 'reset-scoreboard-modal__warning';
  warning.textContent = 'The archived scoreboard cannot be changed.';

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'btn btn--primary';
  confirmButton.textContent = 'Archive & Reset';
  confirmButton.addEventListener('click', async () => {
    console.log('[RESET] confirmation button clicked');
    confirmButton.disabled = true;
    confirmButton.textContent = 'Archiving\u2026';
    try {
      await onConfirm();
      close();
    } catch (error) {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Archive & Reset';
      window.alert('Something went wrong and the scoreboard was not reset. Please try again.');
      console.error('[RESET] FAILED', error);
      console.error('[ResetScoreboardModal] archiveAndReset failed:', error);
    }
  });

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  actions.append(confirmButton, cancelButton);
  modal.append(heading, intro, checklist, warning, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
