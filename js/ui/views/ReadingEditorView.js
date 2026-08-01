/**
 * ui/views/ReadingEditorView.js
 *
 * The first working content editor in ClassMate — reached from
 * Resource Details' "Open Editor" action (see
 * ui/views/ConceptWorkspaceView.js), enabled only for Reading
 * resources; every other type's "Open Editor" stays disabled until
 * that type gets its own editor built the same way this one was.
 *
 * Structured content, not free-form text: an ordered list of blocks
 * (heading, paragraph, image placeholder — see
 * config/readingBlockConfig.js), each independently addable,
 * editable, reorderable, and deletable through
 * services/readingContentService.js. A live, read-only preview
 * beneath the block list uses the exact same
 * ui/components/ReadingContentRenderer.js the student/teacher viewer
 * uses (ui/views/ReadingViewerView.js), so "what you're building" and
 * "what it will look like when read" can never drift apart into two
 * different renderers.
 *
 * Autosaves on every change — no separate Save button — the same
 * convention every other editable screen in this app already uses
 * (Subjects, Units, Concepts, Resource metadata). "Save it, and reopen
 * it later" is satisfied by every edit persisting immediately via
 * workspaceService.save(), not by a manual save step this app doesn't
 * otherwise have anywhere.
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which block (if any) is
 * mid-edit. Takes the resource directly and one `onBack`.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as readingContentService from '../../services/readingContentService.js';
import { READING_BLOCK_TYPE_KEYS, getReadingBlockTypeLabel, getReadingBlockTypeIcon } from '../../config/readingBlockConfig.js';
import { createReadingContentElement } from '../components/ReadingContentRenderer.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';

export function renderReadingEditorView(container, { classroom, resource, onBack }) {
  function rerender() {
    renderEditor(container, classroom, resource, { onBack, rerender });
  }
  rerender();
}

function renderEditor(container, classroom, resource, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'reading-editor';

  const header = document.createElement('header');
  header.className = 'reading-editor__header';

  const backButton = createBackButton(handlers.onBack);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'reading-editor__title';
  title.textContent = resource.title;
  header.appendChild(title);

  const savedNote = document.createElement('p');
  savedNote.className = 'reading-editor__saved-note';
  savedNote.textContent = 'Every change here saves automatically.';
  header.appendChild(savedNote);

  wrapper.appendChild(header);

  const content = readingContentService.getReadingContent(resource);

  const blockList = document.createElement('div');
  blockList.className = 'reading-editor__block-list';

  if (content.blocks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'reading-editor__empty-message';
    empty.textContent = 'No content yet — add a heading, paragraph, or image placeholder below.';
    blockList.appendChild(empty);
  } else {
    content.blocks.forEach((block, index) => {
      blockList.appendChild(createBlockEditorRow(classroom, resource, block, index, content.blocks.length, handlers));
    });
  }

  wrapper.appendChild(blockList);

  const addRow = document.createElement('div');
  addRow.className = 'reading-editor__add-row';
  READING_BLOCK_TYPE_KEYS.forEach((type) => {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--ghost';
    addButton.appendChild(createIcon(getReadingBlockTypeIcon(type), { size: 16 }));
    addButton.append(` + Add ${getReadingBlockTypeLabel(type)}`);
    addButton.addEventListener('click', () => {
      readingContentService.addBlock(resource, type);
      workspaceService.save(classroom);
      handlers.rerender();
    });
    addRow.appendChild(addButton);
  });
  wrapper.appendChild(addRow);

  // Live preview — the exact same renderer the read-only viewer uses.
  const previewHeading = document.createElement('h2');
  previewHeading.className = 'reading-editor__preview-heading';
  previewHeading.textContent = 'Preview';
  wrapper.appendChild(previewHeading);

  const previewFrame = document.createElement('div');
  previewFrame.className = 'reading-editor__preview-frame';
  previewFrame.appendChild(createReadingContentElement(content));
  wrapper.appendChild(previewFrame);

  container.appendChild(wrapper);
}

function createBlockEditorRow(classroom, resource, block, index, total, handlers) {
  const row = document.createElement('div');
  row.className = 'reading-editor__block-row';

  const reorderColumn = document.createElement('div');
  reorderColumn.className = 'reading-editor__block-reorder';

  const upButton = document.createElement('button');
  upButton.type = 'button';
  upButton.className = 'reading-editor__block-reorder-button';
  upButton.textContent = '\u25b2';
  upButton.setAttribute('aria-label', 'Move block up');
  upButton.disabled = index === 0;
  upButton.addEventListener('click', () => {
    readingContentService.moveBlockUp(resource, block.id);
    workspaceService.save(classroom);
    handlers.rerender();
  });

  const downButton = document.createElement('button');
  downButton.type = 'button';
  downButton.className = 'reading-editor__block-reorder-button';
  downButton.textContent = '\u25bc';
  downButton.setAttribute('aria-label', 'Move block down');
  downButton.disabled = index === total - 1;
  downButton.addEventListener('click', () => {
    readingContentService.moveBlockDown(resource, block.id);
    workspaceService.save(classroom);
    handlers.rerender();
  });

  reorderColumn.append(upButton, downButton);
  row.appendChild(reorderColumn);

  const typeBadge = document.createElement('span');
  typeBadge.className = 'reading-editor__block-type-badge';
  typeBadge.appendChild(createIcon(getReadingBlockTypeIcon(block.type), { size: 14 }));
  const typeLabel = document.createElement('span');
  typeLabel.textContent = getReadingBlockTypeLabel(block.type);
  typeBadge.appendChild(typeLabel);
  row.appendChild(typeBadge);

  const isHeading = block.type === 'heading';
  const input = isHeading ? document.createElement('input') : document.createElement('textarea');
  if (isHeading) input.type = 'text';
  input.className = 'reading-editor__block-input';
  input.value = block.text;
  input.placeholder =
    block.type === 'heading' ? 'Heading text' : block.type === 'paragraph' ? 'Paragraph text' : 'Caption for this image (e.g. "Diagram of a pressure gauge")';
  input.addEventListener('change', () => {
    readingContentService.updateBlockText(resource, block.id, input.value);
    workspaceService.save(classroom);
    handlers.rerender();
  });
  row.appendChild(input);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--text btn--danger-text';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => {
    if (!window.confirm('Delete this block?')) return;
    readingContentService.deleteBlock(resource, block.id);
    workspaceService.save(classroom);
    handlers.rerender();
  });
  row.appendChild(deleteButton);

  return row;
}
