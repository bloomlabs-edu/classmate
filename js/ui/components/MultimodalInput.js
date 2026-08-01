/**
 * ui/components/MultimodalInput.js
 *
 * A reusable composer, modeled directly on ChatGPT's own input area —
 * one place a teacher provides content, in whatever form it's most
 * natural to reach for: type it, paste it as text, paste a screenshot
 * (Ctrl+V), drag files in, or browse for them. This supersedes
 * ui/components/AttachmentCanvas.js and, before that,
 * ui/components/FileDropZone.js — two earlier, narrower iterations
 * built around "upload a file" as the mental model. The real
 * abstraction a teacher actually reaches for is simpler than either:
 * "give the AI these pages," regardless of which physical form a page
 * happens to arrive in. Both earlier files are removed, not left
 * behind unreferenced — three generations of the same solved problem
 * sitting in the codebase is real clutter, not a defensible
 * compatibility layer.
 *
 * Deliberately built with no knowledge of Curriculum, Units, OCR, or
 * Extraction Providers — this file's entire contract is producing a
 * normalized `{ text, attachments }` pair from whatever a teacher did
 * with it. What happens next (OCR on the attachments, combining that
 * with the typed text, handing the result to an ExtractionProvider)
 * is entirely the caller's concern — see
 * ui/views/CurriculumManagementView.js's own onProcessComposerInput()
 * for the Curriculum Builder's use of it today, and the intent is
 * genuinely for this component to be reusable anywhere else in
 * ClassMate a teacher needs to hand content to an AI workflow, not
 * just here.
 *
 * Interaction, matching ChatGPT's own composer precisely:
 *   - Clicking anywhere in the textarea gives it normal focus — nothing
 *     special, since it's a real <textarea>.
 *   - Ctrl+V while focused: an image in the clipboard becomes an
 *     attachment (never inserted as text/a data URL); plain text
 *     falls through to the textarea's own native paste behavior
 *     entirely unmodified — this file never touches that case at all.
 *   - Drag-and-drop anywhere on the composer adds attachments.
 *   - The "+" button — not the textarea itself — opens the file
 *     browser. Clicking the textarea should just focus it for typing,
 *     the same as ChatGPT's own composer never opens a file picker
 *     just because you clicked into the message box.
 *   - Attachments render as thumbnails below the composer, each
 *     removable.
 *
 * The 'paste' listener lives on the textarea itself (which is
 * naturally focusable), not on `document` — this app's views rebuild
 * their whole DOM tree from scratch on every re-render
 * (`container.innerHTML = ''`), and a document-level listener isn't
 * cleaned up by that; ui/components/SearchableSelect.js and
 * ui/components/OverflowMenu.js already had to solve exactly this for
 * their own document-level listeners (explicit add/remove on
 * open/close). An element-scoped listener is discarded for free the
 * moment the element itself is.
 */

import { createIcon } from './Icon.js';

export function createMultimodalInput({ text, attachments, placeholder, onTextChange, onAttachmentsAdded, onRemoveAttachment }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'multimodal-input';

  const row = document.createElement('div');
  row.className = 'multimodal-input__row';

  const plusButton = document.createElement('button');
  plusButton.type = 'button';
  plusButton.className = 'multimodal-input__plus-button';
  plusButton.setAttribute('aria-label', 'Attach files');
  plusButton.appendChild(createIcon('file-up', { size: 18 }));
  row.appendChild(plusButton);

  const textarea = document.createElement('textarea');
  textarea.className = 'multimodal-input__textarea';
  textarea.placeholder = placeholder || 'Type, paste text or a screenshot, or drag files in\u2026';
  textarea.rows = 4;
  textarea.value = text || '';
  row.appendChild(textarea);

  wrapper.appendChild(row);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
  fileInput.multiple = true;
  fileInput.className = 'multimodal-input__file-input';
  wrapper.appendChild(fileInput);

  plusButton.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) onAttachmentsAdded(fileInput.files);
    fileInput.value = ''; // allow re-selecting the same file again later (e.g. after removing it)
  });

  textarea.addEventListener('input', () => onTextChange(textarea.value));

  // Only an image in the clipboard is intercepted — plain text paste
  // is never touched here at all, so the textarea's own native paste
  // behavior (cursor position, undo history, everything) works
  // exactly as it would with no listener present.
  textarea.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      onAttachmentsAdded(files);
    }
  });

  wrapper.addEventListener('dragover', (event) => {
    event.preventDefault();
    wrapper.classList.add('multimodal-input--active');
  });

  wrapper.addEventListener('dragleave', () => {
    wrapper.classList.remove('multimodal-input--active');
  });

  wrapper.addEventListener('drop', (event) => {
    event.preventDefault();
    wrapper.classList.remove('multimodal-input--active');
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) onAttachmentsAdded(files);
  });

  if (attachments.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'multimodal-input__attachments';
    attachments.forEach((attachment) => {
      grid.appendChild(createAttachmentThumbnail(attachment, () => onRemoveAttachment(attachment.id)));
    });
    wrapper.appendChild(grid);
  }

  return wrapper;
}

function createAttachmentThumbnail(attachment, onRemove) {
  const card = document.createElement('div');
  card.className = 'multimodal-input__thumbnail';

  if (attachment.file.type.startsWith('image/') && attachment.previewUrl) {
    const img = document.createElement('img');
    img.className = 'multimodal-input__thumbnail-image';
    img.src = attachment.previewUrl;
    img.alt = attachment.file.name;
    card.appendChild(img);
  } else {
    // A PDF (or anything without an image preview) gets a generic
    // file icon, not a rendered page preview — a real visual PDF
    // thumbnail would need real-browser canvas/pdf.js rendering this
    // project's own renderPageToImageBlob() already flags as
    // unverified in this sandbox, and isn't necessary just to confirm
    // "a file was attached."
    const iconWrap = document.createElement('div');
    iconWrap.className = 'multimodal-input__thumbnail-icon';
    iconWrap.appendChild(createIcon('file-text', { size: 28 }));
    card.appendChild(iconWrap);
  }

  const nameLabel = document.createElement('p');
  nameLabel.className = 'multimodal-input__thumbnail-name';
  nameLabel.textContent = attachment.file.name;
  card.appendChild(nameLabel);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'multimodal-input__thumbnail-remove';
  removeButton.setAttribute('aria-label', `Remove ${attachment.file.name}`);
  removeButton.textContent = '\u00d7';
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemove();
  });
  card.appendChild(removeButton);

  return card;
}
