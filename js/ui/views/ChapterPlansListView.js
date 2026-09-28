/**
 * ui/views/ChapterPlansListView.js
 *
 * The front door to Chapter Planning — every ChapterPlan THIS Fellow
 * authored (see models/ChapterPlan.js), newest-edited first, plus
 * "+ Create Chapter Plan". Modeled directly on
 * ui/views/LessonPlansListView.js's own shape, with one deliberate
 * difference: this list is scoped to `createdByUid === currentUser.uid`
 * only, never every ChapterPlan in the classroom — per explicit product
 * direction, "the primary cross-Fellow discovery mechanism is Sparks
 * and Resources," never a list of other Fellows' full Chapter Plans.
 * (LessonPlansListView shows every classroom member's plans and routes
 * a non-author's row to a review view — that pattern is deliberately
 * NOT reused here; the PM review queue/detail views are a later phase,
 * not built yet.)
 *
 * One-time fetch on mount, same "a classroom's own plan library is
 * realistically a handful of documents, not a case that needs a live
 * listener" reasoning lessonPlanRepository.js's own header comment
 * already documents.
 */

import * as chapterPlanRepository from '../../repositories/chapterPlanRepository.js';
import { getChapterPlanRowDisplay } from './ChapterPlanRowDisplay.js';
import { openChapterPlanCreateModal } from '../components/ChapterPlanCreateModal.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

export function renderChapterPlansListView(container, { classroom, currentUser, onBack, onOpenChapterPlan }) {
  let plans = null; // null = loading
  let loadError = null;

  function rerender() {
    renderList(container, { plans, loadError }, {
      onBack,
      onOpenRow: (plan) => onOpenChapterPlan(plan.id),
      onCreate: () => {
        openChapterPlanCreateModal({
          classroom,
          currentUser,
          onCreated: (plan) => onOpenChapterPlan(plan.id),
        });
      },
    });
  }

  rerender();

  chapterPlanRepository
    .getChapterPlansForClassroom(classroom.id)
    .then((fetched) => {
      plans = fetched
        .filter((plan) => plan.createdByUid === currentUser?.uid)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      rerender();
    })
    .catch((error) => {
      console.error('[ChapterPlansListView] Failed to load chapter plans:', error);
      loadError = "Couldn't load Chapter Plans. Check your connection and try again.";
      rerender();
    });
}

function renderList(container, { plans, loadError }, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'chapter-plans-list';

  const header = document.createElement('header');
  header.className = 'chapter-plans-list__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'chapter-plans-list__title';
  title.textContent = 'Chapter Plans';
  header.appendChild(title);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary chapter-plans-list__create-button';
  createButton.appendChild(createIcon('plus', { size: 16 }));
  createButton.append(' Create Chapter Plan');
  createButton.addEventListener('click', handlers.onCreate);
  header.appendChild(createButton);

  wrapper.appendChild(header);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'chapter-plans-list__error';
    error.textContent = loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (plans === null) {
    const loading = document.createElement('p');
    loading.className = 'chapter-plans-list__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  if (plans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chapter-plans-list__empty';
    empty.textContent = "No Chapter Plans yet — start planning your first chapter.";
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  const list = document.createElement('div');
  list.className = 'chapter-plans-list__rows';
  plans.forEach((plan) => {
    const display = getChapterPlanRowDisplay(plan);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chapter-plans-list__row';
    row.addEventListener('click', () => handlers.onOpenRow(plan));

    const textWrap = document.createElement('span');
    textWrap.className = 'chapter-plans-list__row-text';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'chapter-plans-list__row-title';
    rowTitle.textContent = display.title;
    textWrap.appendChild(rowTitle);

    const rowMeta = document.createElement('span');
    rowMeta.className = 'chapter-plans-list__row-meta';
    rowMeta.textContent = display.meta;
    textWrap.appendChild(rowMeta);

    row.appendChild(textWrap);

    const statusBadge = document.createElement('span');
    statusBadge.className = `chapter-plans-list__status-badge chapter-plans-list__status-badge--${plan.status}`;
    statusBadge.textContent = display.statusLabel;
    row.appendChild(statusBadge);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
