/**
 * ui/components/AttachmentCanvas.js
 *
 * The Curriculum Builder's attachment surface — modeled after modern
 * chat applications where one input area accepts pasted screenshots,
 * dropped files, and browsed files interchangeably, and every
 * attachment shows as its own thumbnail a teacher can review and
 * remove before anything happens to it. Replaces
 * ui/components/FileDropZone.js for this use case: a teacher
 * interacts with *pages* here, not text — OCR happens later, once
 * attachments are collected, as its own separate step (see
 * ui/views/CurriculumManagementView.js's renderExtractConceptsStep()).
 *
 * Paste support is genuinely built for the Windows Snipping Tool (or
 * any screenshot tool) workflow this was explicitly designed around:
 * snip a textbook page, Ctrl+V directly into this canvas, done — no
 * save-to-disk-then-browse round trip a teacher would otherwise need.
 *
 * The 'paste' listener is attached to this component's own wrapper
 * element (made focusable via tabindex), not to `document`.
 * Deliberate: this app's views rebuild their entire DOM tree from
 * scratch on every re-render (`container.innerHTML = ''`, see any
 * view's own rerender()), and a document-level listener wouldn't be
 * cleaned up by that — it would keep firing after the component that
 * registered it is gone, the exact leak
 * ui/components/SearchableSelect.js and ui/components/OverflowMenu.js
 * already had to solve for their own document-level "click outside to
 * close" listeners (open()/close() explicitly add/remove). An
 * element-scoped listener has no such problem: it's discarded for
 * free the moment this element itself is. The tradeoff is that a
 * teacher needs to click the canvas once before pasting, which the
 * label text says explicitly, rather than pasting from anywhere on
 * the page working silently and unpredictably.
 *
 * Attachments are plain data the caller owns and passes back in on
 * every render (`{ id, file, previewUrl }[]`) — this component has no
 * state of its own beyond the DOM it builds fresh each call, matching
 * this app's closure-based, "state lives in the view, not the
 * component" convention throughout.
 */

import { createIcon } from './Icon.js';

export function createAttachmentCanvas({ accept, attachments, onFilesAdded, onRemoveAttachment }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'attachment-canvas';
  wrapper.tabIndex = 0; // focusable — required for this element to ever receive its own 'paste' event

  const surface = document.createElement('div');
  surface.className = 'attachment-canvas__surface';

  const surfaceLabel = document.createElement('p');
  surfaceLabel.className = 'attachment-canvas__label';
  surfaceLabel.textContent =
    attachments.length === 0
      ? 'Click here, then paste a screenshot (Ctrl+V) \u2014 or drag files, or click to browse'
      : 'Add more pages: click here and paste (Ctrl+V), drag files, or click to browse';
  surface.appendChild(surfaceLabel);
  wrapper.appendChild(surface);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  if (accept) fileInput.accept = accept;
  fileInput.multiple = true;
  fileInput.className = 'attachment-canvas__input';
  wrapper.appendChild(fileInput);

  surface.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('click', (event) => {
    // Without this, clicking the surface bubbles into fileInput's own
    // native click handling and re-triggers the picker a second time.
    event.stopPropagation();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) onFilesAdded(fileInput.files);
    fileInput.value = ''; // allow re-selecting the same file again later (e.g. after removing it)
  });

  wrapper.addEventListener('dragover', (event) => {
    event.preventDefault();
    wrapper.classList.add('attachment-canvas--active');
  });

  wrapper.addEventListener('dragleave', () => {
    wrapper.classList.remove('attachment-canvas--active');
  });

  wrapper.addEventListener('drop', (event) => {
    event.preventDefault();
    wrapper.classList.remove('attachment-canvas--active');
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) onFilesAdded(files);
  });

  wrapper.addEventListener('paste', (event) => {
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
      onFilesAdded(files);
    }
  });

  if (attachments.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'attachment-canvas__thumbnails';
    attachments.forEach((attachment) => {
      grid.appendChild(createAttachmentThumbnail(attachment, () => onRemoveAttachment(attachment.id)));
    });
    wrapper.appendChild(grid);
  }

  return wrapper;
}

function createAttachmentThumbnail(attachment, onRemove) {
  const card = document.createElement('div');
  card.className = 'attachment-canvas__thumbnail';

  if (attachment.file.type.startsWith('image/') && attachment.previewUrl) {
    const img = document.createElement('img');
    img.className = 'attachment-canvas__thumbnail-image';
    img.src = attachment.previewUrl;
    img.alt = attachment.file.name;
    card.appendChild(img);
  } else {
    // A PDF (or anything without an image preview) gets a generic
    // file icon, not a rendered page preview — a real visual PDF
    // thumbnail would need the same real-browser canvas/pdf.js
    // rendering this project's own renderPageToImageBlob() already
    // flags as unverified in this sandbox, and isn't necessary just
    // to confirm "a file was attached."
    const iconWrap = document.createElement('div');
    iconWrap.className = 'attachment-canvas__thumbnail-icon';
    iconWrap.appendChild(createIcon('file-text', { size: 28 }));
    card.appendChild(iconWrap);
  }

  const nameLabel = document.createElement('p');
  nameLabel.className = 'attachment-canvas__thumbnail-name';
  nameLabel.textContent = attachment.file.name;
  card.appendChild(nameLabel);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'attachment-canvas__thumbnail-remove';
  removeButton.setAttribute('aria-label', `Remove ${attachment.file.name}`);
  removeButton.textContent = '\u00d7';
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemove();
  });
  card.appendChild(removeButton);

  return card;
}
