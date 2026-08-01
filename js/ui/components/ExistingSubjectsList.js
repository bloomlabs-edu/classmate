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
 * A navigation list, per the platform design rules — plain rows with
 * a trailing chevron (see ui/components/NavigationRow.js), no
 * overflow menu here at all. "Change Curriculum" and "Remove Subject"
 * live inside the Subject's own screen now (a Settings "⋮" there —
 * see ui/views/LearningManagementView.js's renderSubjectStep()), not
 * scattered across this list.
 */

import { createNavigationRow } from './NavigationRow.js';

export function renderExistingSubjectsList(subjects, onChooseSubject) {
  const list = document.createElement('div');
  list.className = 'learning-management__subject-card-list';

  subjects.forEach((subject) => {
    list.appendChild(createNavigationRow({ label: subject.title, onClick: () => onChooseSubject(subject) }));
  });

  return list;
}
