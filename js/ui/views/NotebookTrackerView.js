/**
 * ui/views/NotebookTrackerView.js
 *
 * The classroom-level Notebook Tracker screen: every configured Subject
 * → Notebook Type pair as a single tappable row. Opening one goes
 * straight to its Register View (today's date, ready to mark) — there's
 * no intermediate "Mark Today / View Timeline" choice; Timeline is
 * reached from inside the Register View's own header instead, since a
 * teacher's first instinct is "I want to open Handwriting," not "what do
 * I want to do with Handwriting."
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

export function renderNotebookTrackerView(container, { classroom, onBack, onSelectNotebook }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.textContent = '\u2190 Back to Dashboard';
  backButton.addEventListener('click', onBack);
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Notebook Tracker';
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const subjects = notebookConfigService.listSubjects(classroom);

  if (subjects.length === 0) {
    content.appendChild(
      createEmptyStateElement({
        message: 'No subjects or notebook types configured yet. Add some from Settings \u2192 Notebooks.',
      })
    );
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  let hasAnyNotebookType = false;

  subjects.forEach((subject) => {
    const notebookTypes = notebookConfigService.listNotebookTypes(classroom, subject.id);
    if (notebookTypes.length === 0) return;
    hasAnyNotebookType = true;

    const subjectHeading = document.createElement('h2');
    subjectHeading.className = 'profile-section__heading';
    subjectHeading.textContent = subject.name;
    content.appendChild(subjectHeading);

    const list = document.createElement('div');
    list.className = 'activity-list';

    notebookTypes.forEach((notebookType) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'activity-list-card';
      row.addEventListener('click', () => onSelectNotebook(subject.id, notebookType.id));

      const titleRow = document.createElement('div');
      titleRow.className = 'activity-card__title-row';
      const titleEl = document.createElement('span');
      titleEl.className = 'activity-card__title';
      titleEl.textContent = notebookType.name;
      const chevron = document.createElement('span');
      chevron.className = 'activity-card__type';
      chevron.textContent = '\ud83d\udcd2';
      titleRow.append(titleEl, chevron);
      row.appendChild(titleRow);

      list.appendChild(row);
    });

    content.appendChild(list);
  });

  if (!hasAnyNotebookType) {
    content.appendChild(
      createEmptyStateElement({
        message: 'No notebook types configured yet. Add some from Settings \u2192 Notebooks.',
      })
    );
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}
