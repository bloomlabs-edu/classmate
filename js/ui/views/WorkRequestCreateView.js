/**
 * ui/views/WorkRequestCreateView.js
 *
 * Reached only when no WorkRequest is currently open for a given
 * Subject x Notebook Type — services/workRequestService.js's own
 * createNewWorkRequest() throws if one already is (see that
 * function's own header comment for why this doesn't silently
 * auto-close), so this screen never needs to handle that case itself;
 * main.js's own route dispatch already only sends a teacher here when
 * getActiveWorkRequest() found nothing.
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { createBackButton } from '../components/BackButton.js';

export function renderWorkRequestCreateView(container, { classroom, subjectId, notebookTypeId, onBack, onCreated }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'work-request-create';
  wrapper.appendChild(createBackButton(onBack));

  const subject = notebookConfigService.getSubjectById(classroom, subjectId);
  const notebookType = notebookConfigService.listNotebookTypes(classroom, subjectId).find((t) => t.id === notebookTypeId);

  const heading = document.createElement('h1');
  heading.className = 'work-request-create__title';
  heading.textContent = `New ${notebookType?.name || 'Notebook'} Check`;
  wrapper.appendChild(heading);

  const meta = document.createElement('p');
  meta.className = 'work-request-create__meta';
  meta.textContent = subject?.name || '';
  wrapper.appendChild(meta);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'settings-add-row__input';
  titleInput.placeholder = 'e.g. Chapter 4 Notebook Check';
  titleInput.value = `${subject?.name || ''} ${notebookType?.name || ''}`.trim();

  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.className = 'settings-add-row__input';

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', () => {
    if (!titleInput.value.trim()) return;
    const request = workRequestService.createNewWorkRequest(classroom, {
      type: 'notebook',
      title: titleInput.value.trim(),
      subjectId,
      notebookTypeId,
      dueDate: dueDateInput.value,
    });
    onCreated(request.id);
  });

  const form = document.createElement('div');
  form.className = 'settings-section';
  form.append(titleInput, dueDateInput, createButton);
  wrapper.appendChild(form);

  container.appendChild(wrapper);
}
