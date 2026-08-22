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
 * PHASE 3.7 — RESOLVES THE ARCHITECTURAL LIMITATION DOCUMENTED HERE
 * THROUGH PHASE 3.6. READ BEFORE ASSUMING EITHER THE OLD OR THE NEW
 * BEHAVIOUR APPLIES.
 * ==========================================================================
 * Through Phase 3.6, firestore.rules' own
 * `classrooms/{classroomId}/programmeSessions/{sessionId}` block
 * required `request.auth.uid in classroom.memberUids` for every
 * operation — true for a teacher, never true for a student's own
 * per-slot anonymous identity (services/studentAuthService.js), so
 * every read this file performed against that collection — including
 * resolving "today's session" — was rejected outright.
 *
 * PHASE 3.7 fixes this WITHOUT ever granting a student read access to
 * the shared, teacher-facing programmeSessions document itself (still
 * never safe — see the studentEntries rule's own comment for why).
 * Instead: (1) ensureProgrammeMembershipLink() below creates this
 * device's own membershipLinks document — the self-attested uid<->
 * studentId link firestore.rules' own studentEntries/sessionIndex
 * rules require — before any other Firestore read in this file; (2)
 * "today's session" is resolved via
 * services/studentLearningCircleService.js's own
 * getOwnSessionForDate(), which reads only the lightweight
 * sessionIndex pointer plus this student's own studentEntries/goals
 * documents, never the canonical session. This ONLY ever resolves a
 * session created from this phase onward (`usesStudentEntries: true`
 * — see services/programmeSessionService.js's own buildNewSession());
 * a session created before this phase has no sessionIndex entry and
 * remains exactly as unreadable to a student as it always was — not a
 * regression, the same documented, accepted limitation carried
 * forward unchanged for old data.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as studentPortalDataService from '../../../services/studentPortalDataService.js';
import * as learningProgrammeService from '../../../services/learningProgrammeService.js';
import * as studentLearningCircleService from '../../../services/studentLearningCircleService.js';
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

    // PHASE 3.7 — must happen before ANY read below that depends on
    // this device's own membershipLinks document (getOwnSessionForDate()
    // and everything the goal-setting UI does) — see this file's own
    // header comment. A no-op on every call after the first for this
    // uid (see firestoreEnrollmentRepository.js's own
    // ensureLearningProgrammeMembershipLink()).
    await studentLearningCircleService.ensureProgrammeMembershipLink(classroom.id, programme.id, studentId);
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
    session = await studentLearningCircleService.getOwnSessionForDate(classroom.id, programme.id, getTodayDateKey());
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

  const { element: saveIndicator, persistPatch, persistCustom } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  // PHASE 3.7 — session (from getOwnSessionForDate() above) is always
  // a usesStudentEntries session — see this file's own header
  // comment — so buildGoalPicker's own `goalWriter` branch is the
  // only path this view's goals ever take; `persistPatch` above is
  // passed through unused for the (never-reached) legacy branch, kept
  // only because ui/components/ProgrammeGoalsControls.js's shared
  // function signature still accepts it.
  function goalWriter(_studentId, categoryId, valueOrPatch, isNewGoal) {
    return persistCustom(() => studentLearningCircleService.persistOwnGoal(classroom.id, session.id, categoryId, valueOrPatch, isNewGoal));
  }

  const goalsContainer = document.createElement('div');
  wrapper.appendChild(goalsContainer);

  function redrawGoals() {
    goalsContainer.innerHTML = '';
    programme.configuration.goalFramework.categories.forEach((category) => {
      goalsContainer.appendChild(buildStudentGoalRow(programme, session, studentId, category, editable, persistPatch, redrawGoals, goalWriter));
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
function buildStudentGoalRow(programme, session, studentId, category, editable, persistPatch, redraw, goalWriter) {
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
    pickerContainer.appendChild(buildGoalPicker(programme, session, { id: studentId }, category, persistPatch, redraw, goalWriter));

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
 *
 * PHASE 3.7 — reads via
 * services/studentLearningCircleService.js's own
 * listOwnSessionSummaries(), not
 * services/programmeSessionService.js's own listSessionsForProgramme()
 * (that query requires classroom.memberUids membership — see this
 * file's own header comment). Only ever covers sessions created from
 * this phase onward; a student's progress across any older session
 * simply isn't counted, the same pre-existing, unchanged limitation
 * "today's session" itself already has.
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
      const sessions = await studentLearningCircleService.listOwnSessionSummaries(classroom.id, programme.id);
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
