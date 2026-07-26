/**
 * ui/components/QuickActionsSheet.js
 *
 * The long-press bottom sheet: student name, current bucket, and four
 * actions (Award Badge, Add Note, Change Bucket, Open Full Profile),
 * plus Cancel. "Change Bucket" swaps the sheet's own content for the
 * four bucket options rather than opening another layer — everything
 * here should stay one tap deep. Rendering + wiring only; the caller
 * (see ui/views/TrackerView.js) supplies what each action actually does.
 */

import { getBucketLabel } from '../../config/bucketConfig.js';
import { createIcon } from './Icon.js';

export function openQuickActionsSheet({
  student,
  bucketOptions,
  onAwardBadge,
  onAddNote,
  onChangeBucket,
  onOpenProfile,
}) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Quick Actions');

  function close() {
    overlay.classList.remove('sheet-overlay--visible');
    sheet.classList.remove('bottom-sheet--visible');
    setTimeout(() => overlay.remove(), 200);
  }

  const handle = document.createElement('div');
  handle.className = 'bottom-sheet__handle';

  const name = document.createElement('h2');
  name.className = 'bottom-sheet__name';
  name.textContent = student.name;

  const bucketLine = document.createElement('p');
  bucketLine.className = 'bottom-sheet__bucket';
  bucketLine.textContent = getBucketLabel(student.bucket);

  const actionsList = document.createElement('div');
  actionsList.className = 'bottom-sheet__actions';

  function renderMainActions() {
    actionsList.innerHTML = '';
    actionsList.appendChild(
      createSheetAction(createEmojiIcon('\u2b50'), 'Award Badge', () => {
        close();
        onAwardBadge();
      })
    );
    actionsList.appendChild(
      createSheetAction(createIcon('file-text', { size: 18 }), 'Add Note', () => {
        close();
        onAddNote();
      })
    );
    actionsList.appendChild(createSheetAction(createIcon('folder', { size: 18 }), 'Change Bucket', renderBucketOptions));
    actionsList.appendChild(
      createSheetAction(createIcon('user', { size: 18 }), 'Open Full Profile', () => {
        close();
        onOpenProfile();
      })
    );
  }

  function renderBucketOptions() {
    actionsList.innerHTML = '';
    bucketOptions.forEach(({ key, label }) => {
      const isCurrent = student.bucket === key;
      actionsList.appendChild(
        createSheetAction(null, label + (isCurrent ? ' (current)' : ''), () => {
          close();
          onChangeBucket(key);
        })
      );
    });
    actionsList.appendChild(createSheetAction(createIcon('arrow-left', { size: 18 }), 'Back', renderMainActions));
  }

  renderMainActions();

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'bottom-sheet__cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  sheet.append(handle, name, bucketLine, actionsList, cancelButton);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('sheet-overlay--visible');
    sheet.classList.add('bottom-sheet--visible');
  });
}

function createSheetAction(iconElement, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bottom-sheet__action';

  if (iconElement) {
    iconElement.classList.add('bottom-sheet__action-icon');
    button.appendChild(iconElement);
  }

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  button.appendChild(labelSpan);

  button.addEventListener('click', onClick);
  return button;
}

function createEmojiIcon(emoji) {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = emoji;
  return span;
}
