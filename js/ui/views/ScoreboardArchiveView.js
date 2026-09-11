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
import * as badgeBackfillService from '../../services/badgeBackfillService.js';
import * as achievementService from '../../services/achievementService.js';
import { createRecognitionWall } from '../components/RecognitionWall.js';
import { createBadge } from '../components/Badge.js';
import { BADGE_SIZES } from '../../config/badgeDefinitions.js';
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

  // Badge & Achievement Engine — one-time historical backfill. Every
  // NEW archive from now on already awards Winning Team Member
  // automatically (see services/scoreboardArchiveService.js's own
  // archiveAndReset()); this button exists only to populate Achievement
  // Events for archives that already existed before this feature
  // shipped. Safe to click more than once — services/badgeBackfillService.js's
  // own idempotent design (deterministic Achievement Event ids) means
  // re-running it recomputes and overwrites the exact same events
  // rather than duplicating them, so there is no "did I already run
  // this" state to track here.
  if (archives.length > 0) {
    const backfillButton = document.createElement('button');
    backfillButton.type = 'button';
    backfillButton.className = 'btn btn--text scoreboard-archive__backfill-button';
    backfillButton.textContent = 'Backfill Achievement Badges from Past Cycles';
    backfillButton.addEventListener('click', async () => {
      backfillButton.disabled = true;
      backfillButton.textContent = 'Backfilling…';
      try {
        const summary = await badgeBackfillService.backfillClassroom(classroom.id);
        showToast(
          `Processed ${summary.cyclesProcessed} cycle${summary.cyclesProcessed === 1 ? '' : 's'} — ${summary.newEvents} new award${summary.newEvents === 1 ? '' : 's'} for ${summary.studentsAwarded} student${summary.studentsAwarded === 1 ? '' : 's'}`
        );
      } catch (error) {
        console.error('[ScoreboardArchiveView] Backfill failed:', error);
        showToast("Backfill couldn't complete. Check your connection and try again.");
      } finally {
        backfillButton.disabled = false;
        backfillButton.textContent = 'Backfill Achievement Badges from Past Cycles';
      }
    });
    resetSection.appendChild(backfillButton);
  }

  if (archives.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'scoreboard-archive__empty';
    empty.textContent = 'No archived scoreboards yet. Use Reset Scoreboard above to start a new scoring period.';
    listSection.appendChild(empty);
    return;
  }

  // Recognition previews on this landing page \u2014 real Achievement
  // Events, fetched once for every archive rather than per-card, then
  // filtered by each archive's own cycleId. Fails quietly (empty
  // previews, never a broken page) if this read is denied \u2014 this
  // exact list is also rendered for a lower-trust context nowhere
  // today, but the same defensive pattern used throughout this feature
  // costs nothing here either.
  let allEvents = [];
  try {
    allEvents = await achievementService.listAllEvents(classroom.id);
  } catch (error) {
    console.error('[ScoreboardArchiveView] Failed to load recognition previews:', error);
  }

  listSection.className = 'scoreboard-archive__bento';
  const [mostRecent, ...rest] = archives;
  listSection.appendChild(createArchiveCard(mostRecent, allEvents, onOpenArchive, { variant: 'hero' }));

  if (rest.length > 0) {
    const historicalGrid = document.createElement('div');
    historicalGrid.className = 'scoreboard-archive__historical-grid';
    rest.forEach((archive) => historicalGrid.appendChild(createArchiveCard(archive, allEvents, onOpenArchive, { variant: 'compact' })));
    listSection.appendChild(historicalGrid);
  }
}

/** This archive's own recognition summary \u2014 winner(s) by total (a plain factual read of already-stored scores, not a re-derivation of award eligibility) plus every badge type actually recognised this cycle, from real Achievement Events filtered to this archive's own cycleId. */
function summarizeArchiveRecognition(archive, allEvents) {
  const highestTotal = Math.max(...archive.teams.map((team) => team.total));
  const winners = archive.teams.filter((team) => team.total === highestTotal);

  const cycleEvents = allEvents.filter((event) => event.cycleId === archive.id);
  const groups = achievementService.groupEventsForRecognitionWall(cycleEvents);
  const recognizedCount = groups.reduce((sum, group) => sum + group.recipients.length, 0);

  return { winners, groups, recognizedCount };
}

/**
 * One archive's own card \u2014 `variant: 'hero'` (the most recent cycle)
 * gets the full Bento treatment (larger badge previews, every team's
 * own total); `variant: 'compact'` (every earlier cycle) stays a
 * smaller historical card, still real information, never identical
 * filler. Never assumes Winning Team Member is the only badge that
 * can appear here \u2014 `groups` (from groupEventsForRecognitionWall())
 * drives however many distinct badge types this cycle actually
 * produced.
 */
function createArchiveCard(archive, allEvents, onOpenArchive, { variant }) {
  const { winners, groups, recognizedCount } = summarizeArchiveRecognition(archive, allEvents);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = `scoreboard-archive__card scoreboard-archive__card--${variant}`;
  card.addEventListener('click', () => onOpenArchive(archive.id));

  const dateEl = document.createElement('p');
  dateEl.className = 'scoreboard-archive__card-date';
  dateEl.textContent = formatDisplayDate(archive.createdAt);
  card.appendChild(dateEl);

  const standingsLine = document.createElement('p');
  standingsLine.className = 'scoreboard-archive__card-totals';
  standingsLine.textContent = archive.teams.map((team) => `${team.name} ${team.total >= 0 ? '+' : ''}${team.total}`).join(' \u00b7 ');
  card.appendChild(standingsLine);

  const winnerLine = document.createElement('p');
  winnerLine.className = 'scoreboard-archive__card-winner';
  winnerLine.textContent = `\ud83c\udfc6 ${winners.map((team) => team.name).join(' & ')}`;
  card.appendChild(winnerLine);

  if (groups.length > 0) {
    const recognitionPreview = document.createElement('div');
    recognitionPreview.className = 'scoreboard-archive__card-recognition';
    groups.forEach((group) => {
      recognitionPreview.appendChild(
        createBadge({ family: group.definition.family, recognitionType: group.definition.recognitionType, level: 1, size: variant === 'hero' ? BADGE_SIZES.compact : BADGE_SIZES.small, showLevel: false })
      );
    });
    const recognitionText = document.createElement('span');
    recognitionText.textContent = `${recognizedCount} recognised`;
    recognitionPreview.appendChild(recognitionText);
    card.appendChild(recognitionPreview);
  }

  const viewLink = document.createElement('span');
  viewLink.className = 'scoreboard-archive__card-link';
  viewLink.append('View scoreboard ', createIcon('arrow-right', { size: 16 }));
  card.appendChild(viewLink);

  return card;
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

  // Recognition Wall — "who was recognised, for what" for THIS exact
  // cycle. Names resolve from the archive's own frozen roster (built
  // right above, not the classroom's current student list) — this is
  // what keeps a recognition correctly attributed even for a student
  // who has since changed teams or left the classroom entirely. Never
  // recomputes eligibility here — every recipient shown is exactly and
  // only who services/achievementService.js's awardForCycle() actually
  // created an Achievement Event for, at the time this cycle closed.
  const studentNameById = new Map();
  archive.teams.forEach((team) => team.students.forEach((student) => studentNameById.set(student.id, student.name)));

  try {
    const allEvents = await achievementService.listAllEvents(classroom.id);
    const cycleEvents = allEvents.filter((event) => event.cycleId === archiveId);
    const groups = achievementService.groupEventsForRecognitionWall(cycleEvents);
    wrapper.appendChild(
      createRecognitionWall({
        groups,
        resolveStudentName: (studentId) => studentNameById.get(studentId) || 'Unknown student',
      })
    );
  } catch (error) {
    console.error('[ScoreboardArchiveView] Failed to load Recognition Wall:', error);
  }
}
