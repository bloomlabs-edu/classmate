/**
 * ui/views/ProgramManagerChapterPlanQueueView.js
 *
 * The Program Manager's cross-classroom Chapter Plan review queue —
 * modeled directly on ui/views/ProgramManagerObservationsView.js's own
 * shape (same `chapterPlanReviewIndex`-vs-`weeklyPlanReviewIndex`
 * pattern, same row-list restraint, same reused
 * `.lesson-plan-review-queue*` CSS — no new visual system). Only
 * SUBMITTED entries are ever shown — CHANGES_REQUESTED is the Fellow's
 * own turn to act (see
 * services/chapterPlanReviewIndexService.js's own
 * filterChapterPlanEntriesNeedingReview() comment), and self-authored
 * entries are excluded, same reasoning every sibling queue already
 * documents.
 *
 * `chapterPlanReviewIndex` is a discovery aid ONLY, never the source of
 * truth (see that collection's own firestore.rules block and
 * services/chapterPlanReviewIndexService.js's header comment) — opening
 * a row always navigates to ui/views/ProgramManagerChapterPlanReviewView.js,
 * which re-fetches the REAL, canonical
 * `classrooms/{classroomId}/chapterPlans/{chapterPlanId}` document
 * before showing content or allowing any action. This queue itself
 * never re-fetches canonical data per row (that would defeat the whole
 * purpose of a thin cross-classroom index) — an index entry that's
 * gone stale between being written and being viewed here is exactly
 * what that detail view's own staleness check
 * (chapterPlanReviewIndexService.isChapterPlanReviewIndexEntryStale())
 * is for, not this list.
 *
 * `classrooms` is the same already-in-hand
 * `workspaceService.getState().classrooms` every other classroom-
 * agnostic PM route already reads (see
 * ui/views/ProgramManagerObservationsView.js's own header comment for
 * why that reuse is deliberate).
 */

import * as chapterPlanReviewIndexRepository from '../../repositories/chapterPlanReviewIndexRepository.js';
import { filterChapterPlanEntriesNeedingReview, sortChapterPlanReviewIndexEntries } from '../../services/chapterPlanReviewIndexService.js';
import { getChapterPlanQueueRowDisplay } from './ProgramManagerChapterPlanQueueRowDisplay.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

export function renderProgramManagerChapterPlanQueueView(container, { classrooms, currentUser, onBack, onOpenChapterPlanReview }) {
  let entries = null; // null = loading
  let loadError = null;

  const classroomsById = new Map(classrooms.map((classroom) => [classroom.id, classroom]));

  function rerender() {
    renderQueue(container, { classroomsById, entries, loadError }, { onBack, onOpenChapterPlanReview });
  }

  rerender();

  chapterPlanReviewIndexRepository
    .getChapterPlanReviewIndexEntriesForClassroomIds(classrooms.map((classroom) => classroom.id))
    .then((fetched) => {
      const needingReview = filterChapterPlanEntriesNeedingReview(fetched).filter((entry) => entry.createdByUid !== currentUser?.uid);
      entries = sortChapterPlanReviewIndexEntries(needingReview);
      rerender();
    })
    .catch((error) => {
      console.error('[ProgramManagerChapterPlanQueueView] Failed to load the Chapter Plan review index:', error);
      loadError = "Couldn't load Chapter Plans. Check your connection and try again.";
      rerender();
    });
}

function renderQueue(container, { classroomsById, entries, loadError }, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plan-review-queue';

  const header = document.createElement('header');
  header.className = 'lesson-plan-review-queue__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'lesson-plan-review-queue__title';
  title.textContent = 'Chapter Plans';
  header.appendChild(title);

  wrapper.appendChild(header);

  const subtitle = document.createElement('p');
  subtitle.className = 'lesson-plan-review-queue__subtitle';
  subtitle.textContent = "Chapter Plans from the classrooms you review, waiting for your review.";
  wrapper.appendChild(subtitle);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-review-queue__error';
    error.textContent = loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (entries === null) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plan-review-queue__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lesson-plan-review-queue__empty';
    empty.appendChild(createIcon('check-circle-2', { size: 20 }));
    const text = document.createElement('span');
    text.textContent = "You're all caught up — nothing needs your review right now.";
    empty.appendChild(text);
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lesson-plan-review-queue__rows';
  entries.forEach((entry) => {
    const classroom = classroomsById.get(entry.classroomId);
    const display = getChapterPlanQueueRowDisplay(entry, classroom);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-plan-review-queue__row';
    row.addEventListener('click', () => handlers.onOpenChapterPlanReview(entry.classroomId, entry.chapterPlanId));

    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-review-queue__row-text';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'lesson-plan-review-queue__row-title';
    rowTitle.textContent = `${display.authorName} · ${display.chapterName}`;
    textWrap.appendChild(rowTitle);

    const rowMeta = document.createElement('span');
    rowMeta.className = 'lesson-plan-review-queue__row-meta';
    rowMeta.textContent = display.submittedDateLabel ? `${display.meta} · Submitted ${display.submittedDateLabel}` : display.meta;
    textWrap.appendChild(rowMeta);

    row.appendChild(textWrap);

    const badge = document.createElement('span');
    badge.className = 'lesson-plan-review-queue__status-badge';
    badge.textContent = display.statusLabel;
    row.appendChild(badge);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
