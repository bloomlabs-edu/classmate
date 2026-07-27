/**
 * ui/views/ActivitiesView.js
 *
 * Learning Activities are created once, here, at the classroom level —
 * never from inside a single student's profile (see the brief's
 * workflow). Two screens:
 *   - the list: existing activities + a form to create a new one
 *   - the roster: every student in the classroom, with a status
 *     (+ optional feedback/score) for one specific activity
 * Marking a student's status here is what makes their Student Profile's
 * Learning tab update automatically.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningActivityService from '../../services/learningActivityService.js';
import { ACTIVITY_TYPES } from '../../config/activityTypes.js';
import { SUBMISSION_STATUSES } from '../../config/submissionStatuses.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';

export function renderActivitiesListView(container, { classroom, onBack, onSelectActivity }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Dashboard');
  backButton.addEventListener('click', onBack);
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Learning Activities';
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const activities = learningActivityService.listActivities(classroom);

  if (activities.length === 0) {
    content.appendChild(
      createEmptyStateElement({
        message: 'No learning activities yet. Create an assignment to begin tracking submissions.',
      })
    );
  } else {
    const list = document.createElement('div');
    list.className = 'activity-list';

    activities.forEach((activity) => {
      const rosterSummary = learningActivityService.getActivityRosterSummary(classroom, activity.id);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'activity-list-card';
      card.addEventListener('click', () => onSelectActivity(activity.id));

      const titleRow = document.createElement('div');
      titleRow.className = 'activity-card__title-row';
      const titleEl = document.createElement('span');
      titleEl.className = 'activity-card__title';
      titleEl.textContent = activity.title;
      const typeEl = document.createElement('span');
      typeEl.className = 'activity-card__type';
      typeEl.textContent = activity.type;
      titleRow.append(titleEl, typeEl);
      card.appendChild(titleRow);

      if (activity.dueDate) {
        const due = document.createElement('p');
        due.className = 'profile-section__meta';
        due.textContent = `Due ${activity.dueDate}`;
        card.appendChild(due);
      }

      const summaryLine = document.createElement('p');
      summaryLine.className = 'profile-section__meta';
      summaryLine.textContent = `${rosterSummary.Submitted} Submitted \u00b7 ${rosterSummary['Submitted Late']} Late \u00b7 ${rosterSummary.Missing} Missing`;
      card.appendChild(summaryLine);

      list.appendChild(card);
    });

    content.appendChild(list);
  }

  content.appendChild(renderNewActivityForm(classroom, () => renderActivitiesListView(container, { classroom, onBack, onSelectActivity })));

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderNewActivityForm(classroom, rerender) {
  const form = document.createElement('div');
  form.className = 'profile-section new-activity-form';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'New Learning Activity';
  form.appendChild(heading);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title, e.g. "Plant Kingdom Worksheet"';
  titleInput.className = 'wizard-group-row__name';
  form.appendChild(titleInput);

  const typeSelect = document.createElement('select');
  ACTIVITY_TYPES.forEach((type) => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    typeSelect.appendChild(option);
  });
  form.appendChild(typeSelect);

  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  form.appendChild(dueDateInput);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create Activity';
  createButton.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) {
      window.alert('Enter a title for this activity.');
      return;
    }
    learningActivityService.createActivity(classroom, {
      title,
      type: typeSelect.value,
      dueDate: dueDateInput.value,
    });
    workspaceService.save(classroom);
    rerender();
  });
  form.appendChild(createButton);

  return form;
}

export function renderActivityRosterView(container, { classroom, activityId, onBack, onSelectStudent }) {
  container.innerHTML = '';

  const activity = learningActivityService.getActivityById(classroom, activityId);
  if (!activity) {
    container.appendChild(createEmptyStateElement({ message: 'This activity could not be found.' }));
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Activities');
  backButton.addEventListener('click', onBack);
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = `${activity.title} (${activity.type})`;
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));

  if (allStudents.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'There are no students in this classroom yet.' }));
  } else {
    const rosterList = document.createElement('div');
    rosterList.className = 'activity-roster-list';

    allStudents.forEach(({ student, team }) => {
      rosterList.appendChild(createRosterRow(classroom, student, team, activity, onSelectStudent));
    });

    content.appendChild(rosterList);
  }

  wrapper.appendChild(header);
  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function createRosterRow(classroom, student, team, activity, onSelectStudent) {
  const row = document.createElement('div');
  row.className = 'activity-roster-row';

  let nameEl;
  if (onSelectStudent) {
    nameEl = document.createElement('button');
    nameEl.type = 'button';
    nameEl.className = 'activity-roster-row__name student-name-link';
    nameEl.addEventListener('click', () => onSelectStudent(student.id));
  } else {
    nameEl = document.createElement('span');
    nameEl.className = 'activity-roster-row__name';
  }
  nameEl.textContent = `${student.name} \u00b7 ${team.name}`;

  const existing = student.submissions?.[activity.id] || {};

  const statusSelect = document.createElement('select');
  SUBMISSION_STATUSES.forEach((status) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (learningActivityService.getSubmissionStatus(student, activity.id) === status) option.selected = true;
    statusSelect.appendChild(option);
  });

  const feedbackInput = document.createElement('input');
  feedbackInput.type = 'text';
  feedbackInput.placeholder = 'Feedback (optional)';
  feedbackInput.className = 'activity-roster-row__feedback';
  feedbackInput.value = existing.feedback || '';

  const scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.placeholder = 'Score';
  scoreInput.className = 'activity-roster-row__score';
  scoreInput.value = existing.score ?? '';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--ghost';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => {
    learningActivityService.setSubmissionStatus(classroom, student, activity.id, statusSelect.value, {
      feedback: feedbackInput.value.trim(),
      score: scoreInput.value === '' ? null : Number(scoreInput.value),
    });
    workspaceService.save(classroom);
  });

  row.append(nameEl, statusSelect, feedbackInput, scoreInput, saveButton);
  return row;
}
