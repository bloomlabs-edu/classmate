/**
 * ui/components/ExistingSubjectsList.js
 *
 * Renders exactly the classroom's own persisted Subjects — nothing
 * else, ever. This component's entire contract is "here is a list of
 * Subjects, render them"; it has no concept of a "suggested subject,"
 * no default list, no empty-state fallback that shows anything but
 * what's actually passed in. An empty `subjects` array renders
 * nothing at all, by design — the caller (see
 * ui/views/LearningManagementView.js) is responsible for the "+ Add
 * Subject" button that sits beside this, not this component.
 *
 * This is the deliberate other half of the safeguard described in
 * ui/components/AddSubjectModal.js's own header comment: that file is
 * the only place config/commonSubjectsConfig.js is ever imported;
 * this file is the only thing ui/views/LearningManagementView.js's
 * home screen renders subjects through, and it has no import that
 * could reach suggestion data even if someone tried.
 *
 * A Bento navigation hub, deliberately NOT built on
 * ui/components/NavigationRow.js — that component is the shared,
 * platform-wide standard for full-width navigation rows across
 * Units, Concepts, Students, and Assessment subjects too; reshaping
 * it here would have changed every one of those other screens as
 * well. This file owns its own small, local card markup instead,
 * scoped to only the one screen a Subject list like this appears on
 * — matching the same icon-badge + arrow-circle + title composition
 * ui/views/NotebookTrackerView.js's own bento cards already
 * established (see css/styles.css's own .existing-subjects__* rules),
 * not a new card language.
 *
 * Every card uses the same 'teacher' icon-badge tint (Icon.js's
 * ICON_CATEGORIES) — subjects are peers, not tiered by importance, so
 * no per-subject colour is invented; colour stays restrained per the
 * ClassMate style guide rather than becoming a second way to
 * differentiate cards that are otherwise equal.
 */

import { createIcon, createIconBadge } from './Icon.js';

export function renderExistingSubjectsList(subjects, onChooseSubject) {
  const grid = document.createElement('div');
  grid.className = 'existing-subjects__grid';

  subjects.forEach((subject) => {
    grid.appendChild(createSubjectCard(subject, () => onChooseSubject(subject)));
  });

  return grid;
}

function createSubjectCard(subject, onClick) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'existing-subjects__card';
  card.setAttribute('aria-label', subject.title);
  card.addEventListener('click', onClick);

  const top = document.createElement('div');
  top.className = 'existing-subjects__card-top';
  top.appendChild(createIconBadge('book-open', 'teacher', { size: 44 }));

  const arrow = document.createElement('span');
  arrow.className = 'existing-subjects__card-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.appendChild(createIcon('arrow-right', { size: 16 }));
  top.appendChild(arrow);
  card.appendChild(top);

  const label = document.createElement('span');
  label.className = 'existing-subjects__card-label';
  label.textContent = subject.title;
  card.appendChild(label);

  return card;
}
