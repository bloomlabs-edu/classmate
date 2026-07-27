/**
 * ui/views/ReadingViewerView.js
 *
 * The read-only Reading experience — the same content
 * ui/views/ReadingEditorView.js produces, rendered with zero editing
 * affordances. Deliberately the same shared renderer both a student
 * and a teacher's "preview as read-only" action use (see
 * ui/components/ReadingContentRenderer.js) — there is exactly one
 * implementation of "what does this reading look like when read,"
 * not a teacher-preview version and a separate student version.
 *
 * Reachable today from Resource Details' "Preview" action (see
 * ui/views/ConceptWorkspaceView.js) for a teacher checking what a
 * reading will look like. Not yet wired into any student-facing
 * navigation — the Student Portal has no screen yet for browsing to a
 * Subject/Unit/Concept/Resource at all (that's a separate, larger,
 * not-yet-built feature; see docs/UNIFIED_PLATFORM_ARCHITECTURE.md's
 * roadmap). This view itself is complete and independent of that gap:
 * once student navigation to a Concept's resources exists, wiring a
 * "read this" action to this exact function is the entire integration
 * — nothing here needs to change or know whether its caller is a
 * teacher or a student.
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL. Takes the resource directly and one `onBack`.
 */

import { createReadingContentElement } from '../components/ReadingContentRenderer.js';
import { createIcon } from '../components/Icon.js';

export function renderReadingViewerView(container, { resource, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'reading-viewer';

  const header = document.createElement('header');
  header.className = 'reading-viewer__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back');
  backButton.addEventListener('click', onBack);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'reading-viewer__title';
  title.textContent = resource.title;
  header.appendChild(title);

  wrapper.appendChild(header);
  wrapper.appendChild(createReadingContentElement(resource.content));

  container.appendChild(wrapper);
}
