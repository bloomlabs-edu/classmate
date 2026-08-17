/**
 * ui/views/TrackerView.js
 *
 * Class Mode — a deliberately narrow, focused workspace for actively
 * teaching, not a general classroom-management screen. Tap a student
 * to award a star, swipe left to deduct a point, press and hold for
 * Quick Actions (Award Badge / Add Note / Change Bucket / Open Full
 * Profile) — see ClassModeStudentRow.js and QuickActionsSheet.js.
 *
 * Header actions are limited to what a teacher would realistically
 * press with students in front of them: Undo (instant correction),
 * Notebook Tracker (a real in-class rhythm — marking notebooks while
 * students work independently), Scoreboard Archive (browse past
 * scoring periods), Reset Scoreboard (archives the current
 * scoreboard permanently, then starts a fresh scoring period at
 * zero — see services/scoreboardArchiveService.js), and Review
 * Session (the wrap-up gateway out of teaching mode). Settings and
 * Learning Activities were deliberately removed
 * from this screen — neither has a demonstrated in-class use case,
 * and both now live on the Classroom Dashboard instead, reached only
 * via "Exit Class." See this project's CHANGELOG for the full
 * information-architecture review this reflects.
 *
 * Class Session model: every action still mutates the in-memory
 * classroom object immediately (so the UI stays live), but NOTHING is
 * written to Firestore per-action anymore — see
 * services/classSessionService.js. A session starts automatically the
 * first time this view renders for a classroom; "Review Session" shows
 * a summary of what happened this session, and only "Save Session"
 * there performs the one, single permanent write. "Discard Session"
 * throws every draft change away by re-fetching the classroom from
 * Firestore. Undo still reverses the single most recent action of any
 * kind (see services/classModeService.js) — it no longer triggers its
 * own save, since nothing is saved until the session ends.
 */

import { createTeamStandingsBoardElement } from '../components/TeamStandingsBoard.js';
import { openQuickActionsSheet } from '../components/QuickActionsSheet.js';
import { openAwardBadgeModal } from '../components/AwardBadgeModal.js';
import { openAddNoteModal } from '../components/AddNoteModal.js';
import { showToast } from '../components/Toast.js';
import { renderSessionReview } from '../components/SessionReview.js';
import { openUnsavedSessionDialog } from '../components/UnsavedSessionDialog.js';
import { openResetScoreboardModal } from '../components/ResetScoreboardModal.js';
import { createIcon } from '../components/Icon.js';
import * as badgeService from '../../services/badgeService.js';
import * as noteService from '../../services/noteService.js';
import * as classModeService from '../../services/classModeService.js';
import * as classSessionService from '../../services/classSessionService.js';
import * as scoreboardArchiveService from '../../services/scoreboardArchiveService.js';
import { getDisplayName, getDisplaySubtitle } from '../../services/classroomService.js';

export function renderTrackerView(container, props) {
  const { classroom, onBack, onNotebooks, onOpenScoreboardArchive, onSelectStudent } = props;
  const highlight = props._highlight || {};

  if (!classSessionService.isSessionActive(classroom)) {
    classSessionService.startSession(classroom);
  }

  container.innerHTML = '';

  const rerender = (nextHighlight) => {
    renderTrackerView(container, { ...props, _highlight: nextHighlight || {} });
  };

  if (props._showSessionReview) {
    renderSessionReview(container, {
      classroom,
      onContinueTeaching: () => renderTrackerView(container, { ...props, _showSessionReview: false }),
      onSaveSession: () => {
        classSessionService.commitSession(classroom);
        showToast('Session saved');
        renderTrackerView(container, { ...props, _showSessionReview: false });
      },
      onDiscardSession: async () => {
        await classSessionService.discardSession(classroom);
        showToast('Session discarded — nothing was saved');
        onBack();
      },
    });
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'tracker-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Exit Class');
  backButton.addEventListener('click', () => {
    const { totalActions } = classSessionService.getSessionSummary(classroom);
    if (totalActions === 0) {
      onBack();
      return;
    }
    openUnsavedSessionDialog({
      onDiscardAndLeave: async () => {
        await classSessionService.discardSession(classroom);
        showToast('Session discarded — nothing was saved');
        onBack();
      },
      onSaveAndLeave: () => {
        classSessionService.commitSession(classroom);
        showToast('Session saved');
        onBack();
      },
    });
  });

  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';

  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = getDisplayName(classroom);
  titleBlock.appendChild(title);

  const subtitle = getDisplaySubtitle(classroom);
  if (subtitle) {
    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'tracker-header__subtitle';
    subtitleEl.textContent = subtitle;
    titleBlock.appendChild(subtitleEl);
  }

  const sessionSummaryForIndicator = classSessionService.getSessionSummary(classroom);
  if (sessionSummaryForIndicator.totalActions > 0) {
    const draftIndicator = document.createElement('span');
    draftIndicator.className = 'tracker-header__draft-indicator';
    draftIndicator.innerHTML = '<span class="tracker-header__draft-dot" aria-hidden="true"></span>Unsaved Changes';
    titleBlock.appendChild(draftIndicator);
  }

  const actions = document.createElement('div');
  actions.className = 'tracker-header__actions';

  const hasStudents = classroom.teams.some((team) => team.students.length > 0);

  const undoButton = document.createElement('button');
  undoButton.type = 'button';
  undoButton.className = 'btn btn--ghost btn--icon-only';
  undoButton.appendChild(createIcon('undo-2'));
  undoButton.setAttribute('aria-label', 'Undo last action');
  undoButton.title = 'Undo';
  undoButton.disabled = !classModeService.canUndo(classroom);
  undoButton.addEventListener('click', () => {
    const undone = classModeService.undo(classroom);
    if (undone) {
      showToast('Last action undone');
      rerender();
    }
  });

  // Notebook Tracker is the one administration-adjacent tool kept in
  // Class Mode — walking the room marking notebooks during independent
  // work time is a real, common in-class rhythm, not a management
  // task done at a desk. Settings and Learning Activities were removed
  // entirely (see this project's information-architecture review):
  // neither has a demonstrated in-class use case, and both now live on
  // the Classroom Dashboard instead, reached only after Exit Class.
  const notebooksButton = document.createElement('button');
  notebooksButton.type = 'button';
  notebooksButton.className = 'btn btn--ghost btn--icon-only';
  notebooksButton.appendChild(createIcon('notebook-text'));
  notebooksButton.setAttribute('aria-label', 'Notebook Tracker');
  notebooksButton.title = 'Notebook Tracker';
  notebooksButton.addEventListener('click', onNotebooks);

  // Scoreboard Archive — the one new header control this feature
  // adds. Deliberately just another small icon button, same visual
  // weight as Undo/Notebook Tracker, never a dominant new button —
  // the actual Reset Scoreboard action and its confirmation live one
  // level deeper, inside the view this opens.
  const archiveButton = document.createElement('button');
  archiveButton.type = 'button';
  archiveButton.className = 'btn btn--ghost btn--icon-only';
  archiveButton.appendChild(createIcon('history'));
  archiveButton.setAttribute('aria-label', 'Scoreboard Archive');
  archiveButton.title = 'Scoreboard Archive';
  archiveButton.addEventListener('click', onOpenScoreboardArchive);

  // THE ACTUAL FIX — this button now performs the same permanent
  // archive/reset workflow already used from the Scoreboard Archive
  // screen (scoreboardArchiveService.archiveAndReset(), via the same
  // ResetScoreboardModal), never the old, lighter-weight
  // studentService.resetAllScores() path — that function still
  // exists (see its own file for why it's deliberately left intact,
  // unused-but-not-deleted), but is no longer called from here at
  // all. Renamed throughout from "Reset Session" to "Reset
  // Scoreboard" since that's genuinely what this button now does.
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--ghost btn--icon-only';
  resetButton.appendChild(createIcon('rotate-ccw'));
  resetButton.setAttribute('aria-label', 'Reset Scoreboard');
  resetButton.title = 'Reset Scoreboard';
  resetButton.disabled = !hasStudents;
  resetButton.addEventListener('click', () => {
    console.log('[RESET] header Reset Scoreboard icon clicked');
    openResetScoreboardModal({
      onConfirm: async () => {
        await scoreboardArchiveService.archiveAndReset(classroom);
        classModeService.clearUndoStack(classroom);
        showToast('Scoreboard archived and reset');
        console.log('[RESET] calling rerender() to reflect the reset scoreboard');
        rerender();
        console.log('[RESET] rerender() returned');
      },
    });
  });

  const endClassButton = document.createElement('button');
  endClassButton.type = 'button';
  endClassButton.className = 'btn btn--primary';
  endClassButton.textContent = 'Review Session';
  endClassButton.addEventListener('click', () => {
    renderTrackerView(container, { ...props, _showSessionReview: true });
  });

  actions.append(undoButton, notebooksButton, archiveButton, resetButton, endClassButton);
  header.append(backButton, titleBlock, actions);

  const grid = createTeamStandingsBoardElement({
    classroom,
    highlight: { teamId: highlight.teamId },
    onTap: (student) => handleTap(classroom, findTeamContaining(classroom, student.id), student, rerender),
    onSwipeLeft: (student) => handleSwipeLeft(classroom, findTeamContaining(classroom, student.id), student, rerender),
    onLongPress: (student) => handleLongPress(classroom, findTeamContaining(classroom, student.id), student, { onSelectStudent, rerender }),
  });

  wrapper.append(header, grid);
  container.appendChild(wrapper);

  if (highlight.studentId) {
    const pulseEl = container.querySelector(`[data-student-id="${highlight.studentId}"] .student-row__points`);
    pulseEl?.classList.add('student-row__points--pulse');
  }
}

/** Finds which team a given student currently belongs to — needed because ui/components/TeamStandingsBoard.js's own onTap/onSwipeLeft/onLongPress callbacks only ever pass the student (the same shape every consumer of that board, including the Student Portal, receives), not the team, so this is resolved here rather than the board needing to know why a caller wants it. */
function findTeamContaining(classroom, studentId) {
  return classroom.teams.find((team) => team.students.some((student) => student.id === studentId));
}

function handleTap(classroom, team, student, rerender) {
  classModeService.awardStar(classroom, student);
  classSessionService.recordAction(classroom, 'star', student);
  showToast(`+1 Star awarded to ${student.name}`);
  rerender({ studentId: student.id, teamId: team.id });
}

function handleSwipeLeft(classroom, team, student, rerender) {
  classModeService.deductPoint(classroom, student);
  classSessionService.recordAction(classroom, 'behaviour', student);
  showToast(`-1 Negative recorded for ${student.name}`);
  rerender({ studentId: student.id, teamId: team.id });
}

function handleLongPress(classroom, team, student, { onSelectStudent, rerender }) {
  openQuickActionsSheet({
    student,
    bucketOptions: classModeService.getBucketOptions(),
    groupOptions: classroom.teams.filter((t) => t.id !== team.id).map((t) => ({ id: t.id, name: t.name })),
    onAwardBadge: () => {
      const catalog = badgeService.listCatalog(classroom);
      const availableBadges = catalog.filter((badge) => !(student.badges || []).includes(badge));
      openAwardBadgeModal({
        availableBadges,
        onAwardExisting: (badgeName) => {
          const entry = classModeService.awardBadgeQuick(classroom, student, badgeName);
          if (entry) {
            classSessionService.recordAction(classroom, 'badge', student);
            showToast(`${badgeName} Badge awarded`);
            rerender();
          }
        },
        onCreateAndAward: (badgeName) => {
          badgeService.addBadgeToCatalog(classroom, badgeName);
          const entry = classModeService.awardBadgeQuick(classroom, student, badgeName);
          if (entry) {
            classSessionService.recordAction(classroom, 'badge', student);
            showToast(`${badgeName} Badge awarded`);
            rerender();
          }
        },
      });
    },
    onAddNote: () => {
      openAddNoteModal({
        onSave: ({ teacherName, content, aboutDate }) => {
          noteService.addNote(student, { teacherName, content, aboutDate });
          showToast('Note added');
          rerender();
        },
      });
    },
    onChangeBucket: (bucketKey) => {
      const entry = classModeService.changeBucketQuick(classroom, student, bucketKey);
      if (entry) {
        showToast(`Bucket changed for ${student.name}`);
        rerender();
      }
    },
    onChangeGroup: (newTeamId) => {
      const entry = classModeService.changeGroupQuick(classroom, team, student, newTeamId);
      if (entry) {
        showToast(`${student.name} moved to a new group`);
        rerender();
      }
    },
    onOpenProfile: () => onSelectStudent(student.id),
  });
}
