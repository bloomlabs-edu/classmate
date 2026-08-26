/**
 * ui/views/LearningProgrammesListView.js
 *
 * The classroom-level entry point into Learning Programmes — reached
 * from the Dashboard's own "Learning Programmes" module card (see
 * ui/views/DashboardView.js). Shows every programme this classroom
 * has, active or archived, with a card per programme (name,
 * description, status, active member count, most recent session
 * date) and a "+ Create Learning Programme" action.
 *
 * DATA FLOW, followed exactly per this project's own Phase 2A
 * authorization: this view calls
 * services/learningProgrammeService.js to read/create programme
 * CONFIGURATION (which lives embedded on the classroom document, see
 * models/LearningProgramme.js) and persists those changes via
 * services/workspaceService.js's save() — the same, only existing
 * persistence path for that data, already established in Phase 1.
 * This view never touches services/programmeSessionRepository.js or
 * Firestore directly, and never will: session HISTORY is a
 * completely separate concern, read only by
 * ui/views/LearningProgrammeOverviewView.js/ui/views/ProgrammeSessionView.js.
 *
 * Most-recent-session-date is fetched once per programme via
 * services/programmeSessionService.js's own listSessionsForProgramme()
 * — a real Firestore read (session history lives in its own
 * subcollection, never embedded on the classroom document) — so this
 * view is async, matching this app's own established pattern for any
 * screen that needs to read Learning Programme session history (see
 * e.g. ui/views/FeedModerationView.js's own async render + in-place
 * refresh() shape).
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { openCreateLearningProgrammeModal } from '../components/CreateLearningProgrammeModal.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

export async function renderLearningProgrammesListView(container, { classroom, onBack, onSelectProgramme }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-programmes-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Teaching Programmes';
  header.appendChild(title);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = '+ Create Teaching Programme';
  createButton.addEventListener('click', () => {
    openCreateLearningProgrammeModal({
      classroom,
      onCreate: ({ name, description, studentIds, configuration }, closeModal) => {
        const programme = learningProgrammeService.createNewLearningProgramme(classroom, {
          name,
          description,
          configuration,
        });
        studentIds.forEach((studentId) => learningProgrammeService.addMembership(programme, studentId));
        workspaceService.save(classroom);
        closeModal();
        renderLearningProgrammesListView(container, { classroom, onBack, onSelectProgramme });
      },
    });
  });
  header.appendChild(createButton);

  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const programmes = learningProgrammeService.listLearningProgrammes(classroom);

  if (programmes.length === 0) {
    const empty = createEmptyStateElement({
      message: 'Create a programme to track learning that happens beyond the regular school classroom.',
    });
    const emptyStateCreateButton = document.createElement('button');
    emptyStateCreateButton.type = 'button';
    emptyStateCreateButton.className = 'btn btn--primary';
    emptyStateCreateButton.textContent = 'Create Teaching Programme';
    emptyStateCreateButton.addEventListener('click', () => createButton.click());
    empty.appendChild(emptyStateCreateButton);
    content.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'learning-programme-list';

    // Fetched in parallel — each is an independent, one-shot read of
    // one programme's own session history (see this file's own
    // header comment); no programme's own card blocks on another's.
    const summaries = await Promise.all(
      programmes.map(async (programme) => {
        const sessions = await programmeSessionService.listSessionsForProgramme(classroom.id, programme.id);
        const mostRecentDate = sessions[0]?.date || null; // listSessionsForProgramme() already returns most-recent-first
        return { programme, mostRecentDate };
      })
    );

    summaries.forEach(({ programme, mostRecentDate }) => {
      list.appendChild(createProgrammeCard(programme, mostRecentDate, onSelectProgramme));
    });

    content.appendChild(list);
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function createProgrammeCard(programme, mostRecentDate, onSelectProgramme) {
  const activeMemberCount = learningProgrammeService.getActiveMembers(programme).length;

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'activity-list-card learning-programme-card';
  card.addEventListener('click', () => onSelectProgramme(programme.id));

  const titleRow = document.createElement('div');
  titleRow.className = 'activity-card__title-row';
  const titleEl = document.createElement('span');
  titleEl.className = 'activity-card__title';
  titleEl.textContent = programme.name;
  titleRow.appendChild(titleEl);

  if (programme.status === 'archived') {
    const statusChip = document.createElement('span');
    statusChip.className = 'learning-programme-card__status learning-programme-card__status--archived';
    statusChip.textContent = 'Archived';
    titleRow.appendChild(statusChip);
  }
  card.appendChild(titleRow);

  if (programme.description) {
    const descriptionEl = document.createElement('p');
    descriptionEl.className = 'profile-section__meta';
    descriptionEl.textContent = programme.description;
    card.appendChild(descriptionEl);
  }

  const summaryLine = document.createElement('p');
  summaryLine.className = 'profile-section__meta';
  const memberText = `${activeMemberCount} student${activeMemberCount === 1 ? '' : 's'}`;
  const sessionText = mostRecentDate ? `Last session: ${formatDateKey(mostRecentDate)}` : 'No sessions yet';
  summaryLine.textContent = `${memberText} \u00b7 ${sessionText}`;
  card.appendChild(summaryLine);

  return card;
}
