/**
 * ui/views/ChapterPlanEditorTabDisplay.js
 *
 * Pure tab-resolution logic for ui/views/ChapterPlanEditorView.js's own
 * `[ Chapter ] [ Weeks ] [ Lessons ]` tab strip — kept in its own
 * dependency-free file, not inline in ChapterPlanEditorView.js itself,
 * for the same reason ui/views/ChapterPlanRowDisplay.js exists:
 * ChapterPlanEditorView.js transitively imports Firestore-touching
 * repositories (which import the Firebase SDK from a `https://` URL),
 * which crashes under plain `node --test` (ERR_UNSUPPORTED_ESM_URL_SCHEME)
 * — this one decision needs to stay directly unit-testable.
 */

export const CHAPTER_PLAN_EDITOR_TABS = Object.freeze({
  CHAPTER: 'chapter',
  WEEKS: 'weeks',
  LESSONS: 'lessons',
});

/**
 * `?tab=` query param -> which tab should be active on load. Anything
 * other than exactly `'weeks'`/`'lessons'` (missing, empty, unrecognized)
 * resolves to `'chapter'` — a plain `#/classroom/{id}/chapter-plans/{id}`
 * deep link with no `tab` param must never regress from its existing
 * default.
 */
export function resolveInitialChapterPlanTab(tabQueryParam) {
  if (tabQueryParam === CHAPTER_PLAN_EDITOR_TABS.WEEKS) return CHAPTER_PLAN_EDITOR_TABS.WEEKS;
  if (tabQueryParam === CHAPTER_PLAN_EDITOR_TABS.LESSONS) return CHAPTER_PLAN_EDITOR_TABS.LESSONS;
  return CHAPTER_PLAN_EDITOR_TABS.CHAPTER;
}
