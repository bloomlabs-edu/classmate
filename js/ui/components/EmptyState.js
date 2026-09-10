/**
 * ui/components/EmptyState.js
 *
 * A generic "nothing here yet" message, used wherever a list is legitimately
 * empty (e.g. a classroom with no groups yet). Takes its message as a prop
 * rather than hardcoding one, since it's now reused in more than one place.
 *
 * `compact: true` opts into a smaller, left-aligned treatment for an
 * empty state living INSIDE an already-bounded container (a Bento
 * tile, a card) rather than standing alone as a page's entire content
 * — the default 3rem/1.5rem centered padding reads as a huge void in
 * that context (see ui/views/LearningManagementView.js's Units tile).
 * Every existing call site keeps the default (unset) full treatment;
 * this is purely additive.
 */

export function createEmptyStateElement({ message = 'Nothing here yet.', compact = false } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = compact ? 'empty-state empty-state--compact' : 'empty-state';

  const text = document.createElement('p');
  text.className = 'empty-state__message';
  text.textContent = message;

  wrapper.appendChild(text);
  return wrapper;
}
