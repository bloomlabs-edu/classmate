/**
 * ui/views/ScoreboardArchiveView.js
 *
 * Scoreboard Archive — the one new entry point for the permanent
 * Reset Scoreboard feature (see services/scoreboardArchiveService.js
 * for the actual archive+reset logic). Deliberately kept out of the
 * main Class Mode header itself (see ui/views/TrackerView.js's own
 * header, which only gains one small icon button linking here) so
 * the live-teaching screen stays uncluttered — the destructive Reset
 * action and its confirmation live one level deeper, inside this view.
 *
 * Two render modes, chosen by whether `archiveId` is passed:
 *   - No archiveId: the list of every past archive, newest first,
 *     each a summary card, plus the "Reset Scoreboard" entry point.
 *   - archiveId given: one archive's own complete, read-only
 *     historical detail — groups, students, scores, exactly as they
 *     were at the moment of that reset.
 *
 * Deliberately does NOT reuse ui/components/TeamStandingsBoard.js for
 * the detail view: that component is built for LIVE tap-to-award
 * interaction (see ui/views/TrackerView.js), and reusing it here
 * would risk implying an archived score could still be tapped or
 * edited — actively misleading for what must be an immutable record.
 * A plain, explicitly "Archived / Read-only" rendering is used
 * instead — the smallest, clearest-intent choice for this one screen.
 */

import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { openResetScoreboardModal } from '../components/ResetScoreboardModal.js';
import { showToast } from '../components/Toast.js';
import * as scoreboardArchiveService from '../../services/scoreboardArchiveService.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';

function formatDisplayDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function renderScoreboardArchiveView(container, { classroom, archiveId, onBack, onOpenArchive }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management scoreboard-archive';

  const header = document.createElement('div');
  header.className = 'learning-management__header';
  header.appendChild(createBackButton(onBack));

  if (archiveId) {
    await renderDetail(wrapper, header, classroom, archiveId);
  } else {
    await renderList(wrapper, header, classroom, onOpenArchive);
  }

  container.appendChild(wrapper);
}

async function renderList(wrapper, header, classroom, onOpenArchive) {
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Scoreboard Archive';
  header.appendChild(title);
  wrapper.appendChild(header);

  const intro = document.createElement('p');
  intro.className = 'scoreboard-archive__intro';
  intro.textContent = 'Every past scoring period is preserved here permanently. Archiving never changes the students, groups, or current scoreboard.';
  wrapper.appendChild(intro);

  const resetSection = document.createElement('div');
  resetSection.className = 'scoreboard-archive__reset-section';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--secondary';
  resetButton.appendChild(createIcon('rotate-ccw'));
  resetButton.append('Reset Scoreboard');
  const hasStudents = classroom.teams.some((team) => team.students.length > 0);
  resetButton.disabled = !hasStudents;
  resetButton.addEventListener('click', () => {
    openResetScoreboardModal({
      onConfirm: async () => {
        await scoreboardArchiveService.archiveAndReset(classroom);
        showToast('Scoreboard archived and reset');
        onOpenArchive(null); // rerender this same list view, now including the new archive
      },
    });
  });
  resetSection.appendChild(resetButton);
  wrapper.appendChild(resetSection);

  const listSection = document.createElement('div');
  listSection.className = 'scoreboard-archive__list';
  wrapper.appendChild(listSection);

  const archives = await scoreboardArchiveService.listArchives(classroom.id);

  if (archives.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'scoreboard-archive__empty';
    empty.textContent = 'No archived scoreboards yet. Use Reset Scoreboard above to start a new scoring period.';
    listSection.appendChild(empty);
    return;
  }

  archives.forEach((archive) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'scoreboard-archive__card';
    card.addEventListener('click', () => onOpenArchive(archive.id));

    const dateEl = document.createElement('p');
    dateEl.className = 'scoreboard-archive__card-date';
    dateEl.textContent = formatDisplayDate(archive.createdAt);
    card.appendChild(dateEl);

    const studentCount = archive.teams.reduce((sum, team) => sum + team.students.length, 0);
    const meta = document.createElement('p');
    meta.className = 'scoreboard-archive__card-meta';
    meta.textContent = `${archive.teams.length} group${archive.teams.length === 1 ? '' : 's'} \u00b7 ${studentCount} student${studentCount === 1 ? '' : 's'}`;
    card.appendChild(meta);

    const totalsLine = document.createElement('p');
    totalsLine.className = 'scoreboard-archive__card-totals';
    totalsLine.textContent = archive.teams.map((team) => `${team.name} ${team.total}`).join(' \u00b7 ');
    card.appendChild(totalsLine);

    const viewLink = document.createElement('span');
    viewLink.className = 'scoreboard-archive__card-link';
    viewLink.append('View scoreboard ', createIcon('arrow-right', { size: 16 }));
    card.appendChild(viewLink);

    listSection.appendChild(card);
  });
}

async function renderDetail(wrapper, header, classroom, archiveId) {
  const archive = await scoreboardArchiveService.getArchive(classroom.id, archiveId);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'scoreboard-archive__detail-title-block';
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = archive ? `Scoreboard \u2014 ${formatDisplayDate(archive.createdAt)}` : 'Scoreboard Archive';
  titleBlock.appendChild(title);
  const readOnlyBadge = document.createElement('span');
  readOnlyBadge.className = 'scoreboard-archive__readonly-badge';
  readOnlyBadge.textContent = 'Archived \u00b7 Read-only';
  titleBlock.appendChild(readOnlyBadge);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  if (!archive) {
    const notFound = document.createElement('p');
    notFound.className = 'scoreboard-archive__empty';
    notFound.textContent = 'This archived scoreboard could not be found.';
    wrapper.appendChild(notFound);
    return;
  }

  const detailGrid = document.createElement('div');
  detailGrid.className = 'scoreboard-archive__detail-grid';

  archive.teams.forEach((team) => {
    const groupCard = document.createElement('div');
    groupCard.className = 'scoreboard-archive__group-card';
    if (team.color) {
      groupCard.style.borderTopColor = getGroupColorHex(team.color);
    }

    const groupHeader = document.createElement('div');
    groupHeader.className = 'scoreboard-archive__group-header';
    const groupName = document.createElement('span');
    groupName.className = 'scoreboard-archive__group-name';
    groupName.textContent = team.name;
    const groupTotal = document.createElement('span');
    groupTotal.className = 'scoreboard-archive__group-total';
    groupTotal.textContent = team.total;
    groupHeader.append(groupName, groupTotal);
    groupCard.appendChild(groupHeader);

    const studentList = document.createElement('div');
    studentList.className = 'scoreboard-archive__student-list';
    team.students.forEach((student) => {
      const row = document.createElement('div');
      row.className = 'scoreboard-archive__student-row';
      const name = document.createElement('span');
      name.textContent = student.name;
      const score = document.createElement('span');
      score.className = 'scoreboard-archive__student-score';
      score.textContent = student.score;
      row.append(name, score);
      studentList.appendChild(row);
    });
    groupCard.appendChild(studentList);

    detailGrid.appendChild(groupCard);
  });

  wrapper.appendChild(detailGrid);
}
