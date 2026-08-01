/**
 * ui/components/FileDropZone.js
 *
 * A reusable drag-and-drop file picker — the first of its kind in
 * this app (no existing screen had drag-and-drop file upload before
 * this), built as its own shared component rather than one-off inline
 * markup, the same "build it once, reuse it" convention this app
 * already follows for BackButton.js, SearchableSelect.js, and the
 * rest of ui/components/.
 *
 * Always both a real drop target *and* a click-to-browse fallback —
 * drag-and-drop alone would leave keyboard/screen-reader users with
 * no way to select a file at all, the same "the permanent, accessible
 * way to do this, dragging is an additional shortcut alongside it,
 * never a replacement" reasoning
 * ui/views/CurriculumManagementView.js's own Unit-to-Part reordering
 * already applies to its drag handle.
 *
 * `onFilesSelected(fileList)` fires identically whether files arrived
 * by drop or by the file input's own change event — a caller never
 * needs to know or care which one happened.
 */

export function createFileDropZone({ accept, multiple = true, onFilesSelected, label = 'Drag files here, or click to browse' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-drop-zone';

  const labelEl = document.createElement('p');
  labelEl.className = 'file-drop-zone__label';
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  if (accept) fileInput.accept = accept;
  fileInput.multiple = multiple;
  fileInput.className = 'file-drop-zone__input';
  wrapper.appendChild(fileInput);

  wrapper.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('click', (event) => {
    // Without this, clicking the zone bubbles into fileInput's own
    // native click handling and re-triggers it a second time — the
    // wrapper's own listener above already opened the file picker.
    event.stopPropagation();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) onFilesSelected(fileInput.files);
  });

  wrapper.addEventListener('dragover', (event) => {
    event.preventDefault();
    wrapper.classList.add('file-drop-zone--active');
  });

  wrapper.addEventListener('dragleave', () => {
    wrapper.classList.remove('file-drop-zone--active');
  });

  wrapper.addEventListener('drop', (event) => {
    event.preventDefault();
    wrapper.classList.remove('file-drop-zone--active');
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) onFilesSelected(files);
  });

  return wrapper;
}
