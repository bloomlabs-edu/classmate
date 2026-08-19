/**
 * ui/student-portal/views/StudentLearningCircleView.js
 *
 * The first Learning Programme presence anywhere in Student Mode —
 * per this round's own explicit "MUST IMPLEMENT" instruction. Shows
 * the student's own attendance status for today, their own goals per
 * category (with "\ud83d\udca1 Get Suggestions" hidden until explicitly
 * requested, and a custom-goal option — reusing
 * ui/components/ProgrammeGoalsControls.js's own buildGoalPicker()
 * directly, since it was already generic enough to need no teacher-
 * specific rewrite), and a "View Progress" action showing basic,
 * already-available statistics (attendance/goals counts) across this
 * programme's own session history. Never shows teacher-only controls
 * (Edit Goal, outcome-setting buttons, observations) — this screen is
 * deliberately a subset of what the teacher's own screens show, not
 * a mirror of them.
 *
 * ==========================================================================
 * KNOWN, CONFIRMED ARCHITECTURAL LIMITATION — READ BEFORE ASSUMING THIS WORKS
 * ==========================================================================
 * firestore.rules' own `classrooms/{classroomId}/programmeSessions/{sessionId}`
 * block requires `request.auth.uid in classroom.memberUids` for EVERY
 * operation — read, create, and update alike. A student's own device
 * authenticates through services/studentAuthService.js's separate,
 * per-slot ANONYMOUS identity, which is never added to a classroom's
 * own `memberUids` array (that field is exclusively for real,
 * Google-authenticated teacher/owner accounts — confirmed directly by
 * inspection, not assumed). This means every read this file performs
 * against `classrooms/{id}/programmeSessions/*` — including the very
 * first one, resolving today's session — will be REJECTED by Firestore
 * security rules against the real, live project, exactly as it stands
 * today. This is not a bug in this file; it is a genuine, confirmed gap
 * between what this round's own "Student Portal — MUST IMPLEMENT"
 * instruction asks for and what this round's own separate "Do NOT
 * modify Firestore rules" instruction permits fixing. The correct fix —
 * a new, purpose-built rule granting a student's own per-slot identity
 * read (and, if goal-setting is meant to work too, scoped write) access
 * to a session referencing their own studentId, mirroring the
 * denormalized-uid technique classrooms/{id}/studentGoals/* already
 * uses for exactly this same class of problem — is explicitly out of
 * scope this round and must be authorized and implemented separately.
 *
 * Every function in this file is written correctly and will start
 * working the moment that rule exists, with zero code changes here.
 * Until then, every fetch below is wrapped so a permission-denied
 * rejection degrades to the same graceful "can't load this right now"
 * empty state a genuinely missing session would show — never a raw
 * error, never a crash — but the underlying data will not actually
 * load against a live project today. See this round's own
 * implementation report for the full, explicit callout.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as studentPortalDataService from '../../../services/studentPortalDataService.js';
import * as learningProgrammeService from '../../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../../services/programmeSessionService.js';
import { isSessionEditable, summarizeStudentProgress } from '../../components/ProgrammeSessionHelpers.js';
import { buildGoalPicker } from '../../components/ProgrammeGoalsControls.js';
import { createSaveIndicatorController } from '../../components/ProgrammeSessionSaveIndicator.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { getTodayDateKey, formatDateKey } from '../../../utils/dateHelpers.js';

const ATTENDANCE_DISPLAY = {
  present: { icon: '\ud83d\udfe2', label: 'Present' },
  absent: { icon: '\ud83d\udd34', label: 'Absent' },
  late: { icon: '\ud83d\udfe1', label: 'Late' },
};

export async function renderStudentLearningCircleView(container, { onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-learning-circle';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Learning Circle';
  header.appendChild(title);
  wrapper.appendChild(header);
  container.appendChild(wrapper);

  let classroom;
  let programme;
  try {
    const loaded = await studentPortalDataService.loadCurrentStudentAndClassroom();
    if (!loaded) {
      wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
      return;
    }
    classroom = loaded.classroom;

    const studentId = studentDeviceService.getActiveProfile()?.studentId;
    programme = learningProgrammeService
      .listLearningProgrammes(classroom)
      .find((p) => learningProgrammeService.getActiveMembership(p, studentId));

    if (!programme) {
      wrapper.appendChild(createEmptyStateElement({ message: "You're not part of a Learning Circle yet." }));
      return;
    }
  } catch (error) {
    // See this file's own header comment — a permission-denied
    // rejection against the real project degrades to exactly this
    // same message, never a raw error or a crash.
    console.error('[StudentLearningCircleView] Failed to load classroom/programme data:', error);
    wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
    return;
  }

  const studentId = studentDeviceService.getActiveProfile()?.studentId;

  const programmeTitle = document.createElement('h2');
  programmeTitle.className = 'student-learning-circle__programme-name';
  programmeTitle.textContent = programme.name;
  wrapper.appendChild(programmeTitle);

  let session = null;
  try {
    session = await programmeSessionService.findSessionForDate(classroom.id, programme.id, getTodayDateKey());
  } catch (error) {
    console.error('[StudentLearningCircleView] Failed to load today\u2019s session:', error);
  }

  if (!session) {
    wrapper.appendChild(createEmptyStateElement({ message: "Today's circle hasn't started yet \u2014 check back once your teacher begins." }));
    appendViewProgressAction(wrapper, classroom, programme, studentId);
    container.appendChild(wrapper);
    return;
  }

  const dateLine = document.createElement('p');
  dateLine.className = 'student-learning-circle__date';
  dateLine.textContent = formatDateKey(session.date);
  wrapper.appendChild(dateLine);

  const editable = isSessionEditable(session, programme);

  // TODAY — the student's own attendance, read-only from this
  // screen (a student never marks their own attendance; that
  // remains a teacher-only action, unchanged).
  const todayHeading = document.createElement('h3');
  todayHeading.className = 'profile-section__heading';
  todayHeading.textContent = 'TODAY';
  wrapper.appendChild(todayHeading);

  const attendanceEntry = session.attendance[studentId];
  const attendanceLine = document.createElement('p');
  attendanceLine.className = 'student-learning-circle__attendance-line';
  if (attendanceEntry) {
    const display = ATTENDANCE_DISPLAY[attendanceEntry.status];
    attendanceLine.textContent = `${display.icon} ${display.label}`;
  } else {
    attendanceLine.textContent = 'Not yet marked';
  }
  wrapper.appendChild(attendanceLine);

  // Your goals
  const goalsHeading = document.createElement('h3');
  goalsHeading.className = 'profile-section__heading';
  goalsHeading.textContent = 'Your goals';
  wrapper.appendChild(goalsHeading);

  const { element: saveIndicator, persistPatch } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  const goalsContainer = document.createElement('div');
  wrapper.appendChild(goalsContainer);

  function redrawGoals() {
    goalsContainer.innerHTML = '';
    programme.configuration.goalFramework.categories.forEach((category) => {
      goalsContainer.appendChild(buildStudentGoalRow(programme, session, studentId, category, editable, persistPatch, redrawGoals));
    });
  }
  redrawGoals();

  appendViewProgressAction(wrapper, classroom, programme, studentId);
  container.appendChild(wrapper);
}

/**
 * One category's own row — a plain \u2713/\u25cb status plus the goal text
 * once set, or "\ud83d\udca1 Get Suggestions" (reusing
 * ui/components/ProgrammeGoalsControls.js's own buildGoalPicker()
 * directly) for a category with no goal yet, collapsed by default.
 * Deliberately does NOT show outcome-setting buttons or an "Edit
 * Goal" action — those remain teacher-only surfaces on the dedicated
 * Goals review screen; a student's own view stays a simple read +
 * set, matching this round's own mockup exactly.
 */
function buildStudentGoalRow(programme, session, studentId, category, editable, persistPatch, redraw) {
  const row = document.createElement('div');
  row.className = 'student-learning-circle__goal-row';

  const label = document.createElement('span');
  label.className = 'student-learning-circle__goal-category-label';
  label.textContent = category.name;
  row.appendChild(label);

  const goal = session.goals[studentId]?.[category.id] || null;

  if (goal) {
    const statusIcon = document.createElement('span');
    statusIcon.textContent = goal.outcome === 'completed' ? '\u2713' : '\u25cb';
    row.appendChild(statusIcon);
    const text = document.createElement('span');
    text.textContent = goal.text;
    row.appendChild(text);
  } else if (editable) {
    const prompt = document.createElement('p');
    prompt.className = 'profile-section__meta';
    prompt.textContent = 'What do you want to work on today?';
    row.appendChild(prompt);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'btn btn--text';
    toggleButton.textContent = '\ud83d\udca1 Get Suggestions';

    const pickerContainer = document.createElement('div');
    pickerContainer.hidden = true;
    // The student's own view passes { id: studentId } — the picker
    // only ever reads `.id` off the object it's given, so this needs
    // no full roster-derived student record.
    pickerContainer.appendChild(buildGoalPicker(programme, session, { id: studentId }, category, persistPatch, redraw));

    toggleButton.addEventListener('click', () => {
      pickerContainer.hidden = !pickerContainer.hidden;
      toggleButton.textContent = pickerContainer.hidden ? '\ud83d\udca1 Get Suggestions' : 'Hide Suggestions';
    });

    row.append(toggleButton, pickerContainer);
  } else {
    const statusIcon = document.createElement('span');
    statusIcon.textContent = '\u25cb';
    row.appendChild(statusIcon);
    const noneText = document.createElement('span');
    noneText.className = 'profile-section__meta';
    noneText.textContent = 'Goal not set';
    row.appendChild(noneText);
  }

  return row;
}

/**
 * "View Progress" — basic, already-available statistics across this
 * programme's own session history (attendance counts, goals set/
 * completed), per this round's own explicit "use only data already
 * available, do not invent additional metrics yet" instruction.
 * Collapsed by default, same progressive-disclosure principle as
 * everything else this round touched.
 */
function appendViewProgressAction(wrapper, classroom, programme, studentId) {
  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'btn btn--secondary student-learning-circle__progress-toggle';
  toggleButton.textContent = 'View Progress';

  const progressContainer = document.createElement('div');
  progressContainer.hidden = true;

  let loaded = false;
  toggleButton.addEventListener('click', async () => {
    progressContainer.hidden = !progressContainer.hidden;
    if (progressContainer.hidden || loaded) return;

    loaded = true;
    progressContainer.textContent = 'Loading\u2026';
    try {
      const sessions = await programmeSessionService.listSessionsForProgramme(classroom.id, programme.id);
      const summary = summarizeStudentProgress(sessions, studentId);
      progressContainer.innerHTML = '';
      const lines = [
        `${summary.sessionsPresent + summary.sessionsLate} / ${summary.totalSessions} sessions attended`,
        `${summary.sessionsAbsent} sessions missed`,
        `${summary.goalsCompleted} / ${summary.goalsSet} goals completed`,
      ];
      lines.forEach((line) => {
        const p = document.createElement('p');
        p.className = 'profile-section__meta';
        p.textContent = line;
        progressContainer.appendChild(p);
      });
    } catch (error) {
      // See this file's own header comment — a permission-denied
      // rejection degrades to this same message.
      console.error('[StudentLearningCircleView] Failed to load progress:', error);
      progressContainer.textContent = "Progress isn't available right now.";
    }
  });

  wrapper.append(toggleButton, progressContainer);
}
