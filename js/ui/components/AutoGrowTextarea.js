/**
 * ui/components/AutoGrowTextarea.js
 *
 * Attaches auto-growing height behavior to an existing `<textarea>` —
 * height tracks content as the teacher types, so a long-form
 * lesson-planning field (Lesson Objective, Self/Others/India, Spark,
 * Activity Teacher/Student Action, differentiation buckets, Pair
 * Explanation, Final Question, Teacher Look-Fors — every field built
 * on ui/views/LessonPlanBuilderView.js's own createLabeledTextarea())
 * never traps a teacher's real writing inside a tiny fixed-height box
 * with an internal scrollbar. One shared attach point, not a
 * per-field reimplementation, so every long-form field grows exactly
 * the same way.
 *
 * Deliberately just a behavior attached to a plain `<textarea>`, not a
 * new component that WRAPS one — the element this returns nothing
 * from is still exactly the same node the caller already created and
 * wired up (value, placeholder, disabled, its own `change` listener
 * for persistence); this only ever adds height management on top,
 * never replaces or interferes with that.
 *
 * Growing (not shrinking as text is deleted) would leave the box
 * visually "stuck" tall after a teacher clears a paragraph — height is
 * fully recomputed from scratch (`height: auto` first) on every
 * `input`, so it always matches CURRENT content in both directions.
 * CSS (`.lesson-plan-builder__textarea`) sets `resize: none` and
 * `overflow: hidden` to match: a manual resize handle would fight this
 * script's own height, and hidden overflow means no internal
 * scrollbar ever appears during normal editing (the element is always
 * sized tall enough to show everything).
 */
export function attachAutoGrowTextarea(textarea) {
  function resize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  textarea.addEventListener('input', resize);

  // Sizes to whatever content the textarea already has (existing saved
  // text, on first render) — deferred one frame so it runs after this
  // element is actually attached to the document by the caller's own
  // render pass; `scrollHeight` isn't meaningful before layout.
  requestAnimationFrame(resize);
}
