/**
 * ui/views/LearningProgrammeOverviewView.js
 *
 * One Learning Programme's own home screen — "Start Today's Session"
 * (its one primary action), a plain recent-sessions list, member
 * count, and an entry into Settings. Deliberately minimal per this
 * project's own Phase 2A scope: no analytics, no progress engine, no
 * derived percentages — just raw counts (member count, session count)
 * and a list of dates, exactly as authorized.
 *
 * "Start Today's Session" calls
 * services/programmeSessionService.js's own getOrCreateSessionForDate()
 * — added in this same phase specifically so opening this screen
 * twice in one day, or tapping the button twice, can never create two
 * sessions for the same date (see that function's own header comment
 * for the full reasoning). This view never constructs a Firestore
 * document or field path itself.
 *
 * An ARCHIVED programme shows no active "Start Today's Session"
 * button at all — services/programmeSessionService.js's own
 * ensureProgrammeCanStartNewSession() (Phase 1.6) is the real domain
 * guard; this view's own job is only to not present an action that
 * guard would refuse, matching this project's own explicit "the UI
 * should respect this" instruction. Historical sessions remain fully
 * reachable regardless of archived status — the recent-sessions list
 * below is never filtered by it.
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getTodayDateKey, formatDateKey } from '../../utils/dateHelpers.js';

export async function renderLearningProgrammeOverviewView(container, { classroom, programmeId, onBack, onOpenSession, onOpenSettings }) {
  container.innerHTML = '';

  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    container.appendChild(createEmptyStateElement({ message: 'This Learning Programme could not be found.' }));
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-programme-overview';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = programme.name;
  titleBlock.appendChild(title);
  if (programme.status === 'archived') {
    const archivedSubtitle = document.createElement('p');
    archivedSubtitle.className = 'tracker-header__subtitle';
    archivedSubtitle.textContent = 'Archived \u2014 no new sessions can be started';
    titleBlock.appendChild(archivedSubtitle);
  }
  header.appendChild(titleBlock);

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'btn btn--icon-only';
  settingsButton.setAttribute('aria-label', 'Programme Settings');
  settingsButton.textContent = '\u2699\ufe0f';
  settingsButton.addEventListener('click', onOpenSettings);
  header.appendChild(settingsButton);

  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const activeMemberCount = learningProgrammeService.getActiveMembers(programme).length;

  const memberStat = document.createElement('p');
  memberStat.className = 'profile-section__meta learning-programme-overview__member-count';
  memberStat.textContent = `${activeMemberCount} member${activeMemberCount === 1 ? '' : 's'}`;
  content.appendChild(memberStat);

  if (programme.status === 'archived') {
    const archivedNotice = document.createElement('div');
    archivedNotice.className = 'learning-programme-overview__archived-notice';
    archivedNotice.textContent = 'This programme is archived. Its members and past sessions remain here, but no new session can be started.';
    content.appendChild(archivedNotice);
  } else {
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'btn btn--primary btn--large learning-programme-overview__start-button';
    startButton.textContent = 'Start Today\u2019s Session';
    startButton.addEventListener('click', async () => {
      startButton.disabled = true;
      startButton.textContent = 'Opening\u2026';
      try {
        const session = await programmeSessionService.getOrCreateSessionForDate(classroom, {
          programmeId: programme.id,
          date: getTodayDateKey(),
        });
        onOpenSession(session.id);
      } catch (error) {
        window.alert(`Could not start today's session: ${error.message}`);
        startButton.disabled = false;
        startButton.textContent = 'Start Today\u2019s Session';
      }
    });
    content.appendChild(startButton);
  }

  const sessionsHeading = document.createElement('h2');
  sessionsHeading.className = 'profile-section__heading';
  sessionsHeading.textContent = 'Recent Sessions';
  content.appendChild(sessionsHeading);

  const sessions = await programmeSessionService.listSessionsForProgramme(classroom.id, programme.id);

  if (sessions.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No sessions yet.' }));
  } else {
    const sessionList = document.createElement('div');
    sessionList.className = 'learning-programme-overview__session-list';

    // Already most-recent-first (see programmeSessionRepository.js's
    // own listSessionsForProgramme()) — a raw, uncapped list matches
    // this phase's own "basic list of previous sessions" scope; no
    // pagination/derived summary is attempted here.
    sessions.forEach((session) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'learning-programme-overview__session-row';
      row.addEventListener('click', () => onOpenSession(session.id));

      const dateEl = document.createElement('span');
      dateEl.className = 'learning-programme-overview__session-row-date';
      dateEl.textContent = formatDateKey(session.date);
      row.appendChild(dateEl);

      if (session.title) {
        const titleSpan = document.createElement('span');
        titleSpan.className = 'learning-programme-overview__session-row-title';
        titleSpan.textContent = session.title;
        row.appendChild(titleSpan);
      }

      // A cheap, already-in-memory count — Object.keys() over a
      // student-keyed map (see models/ProgrammeSession.js's own
      // Phase 1.6 restructuring), not a derived statistic requiring
      // any further computation or a separate progress engine.
      const attendanceCount = Object.keys(session.attendance || {}).length;
      if (attendanceCount > 0) {
        const countSpan = document.createElement('span');
        countSpan.className = 'learning-programme-overview__session-row-count';
        countSpan.textContent = `${attendanceCount} marked`;
        row.appendChild(countSpan);
      }

      sessionList.appendChild(row);
    });

    content.appendChild(sessionList);
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}
