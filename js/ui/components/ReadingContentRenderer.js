/**
 * ui/components/ReadingContentRenderer.js
 *
 * Renders a Reading resource's content (see models/ReadingContent.js)
 * as read-only markup — a pure function of the content, with no
 * editing affordances of any kind. Used by both
 * ui/views/ReadingViewerView.js (the student/teacher-preview
 * read-only screen) and, as a live preview alongside the block list,
 * ui/views/ReadingEditorView.js — one rendering implementation, not a
 * second one duplicated between "what the editor shows as a preview"
 * and "what the viewer shows," which would be exactly the kind of
 * duplication this app's development principles rule out.
 */

export function createReadingContentElement(content) {
  const wrapper = document.createElement('div');
  wrapper.className = 'reading-content';

  const blocks = content?.blocks || [];

  if (blocks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'reading-content__empty';
    empty.textContent = 'This reading has no content yet.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  blocks.forEach((block) => {
    wrapper.appendChild(createBlockElement(block));
  });

  return wrapper;
}

function createBlockElement(block) {
  if (block.type === 'heading') {
    const heading = document.createElement('h2');
    heading.className = 'reading-content__heading';
    heading.textContent = block.text || '(Empty heading)';
    return heading;
  }

  if (block.type === 'image_placeholder') {
    const placeholder = document.createElement('div');
    placeholder.className = 'reading-content__image-placeholder';
    const icon = document.createElement('span');
    icon.className = 'reading-content__image-placeholder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u{1F5BC}\uFE0F';
    const caption = document.createElement('span');
    caption.className = 'reading-content__image-placeholder-caption';
    caption.textContent = block.text || 'Image';
    placeholder.append(icon, caption);
    return placeholder;
  }

  // 'paragraph', and the fallback for any unrecognized block type —
  // rendering it as plain text is more honest than silently dropping
  // a block a future type might add before this file is updated for it.
  const paragraph = document.createElement('p');
  paragraph.className = 'reading-content__paragraph';
  paragraph.textContent = block.text || '';
  return paragraph;
}
