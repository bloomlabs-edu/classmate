/**
 * ui/student-portal/views/StudentLearningCircleView.js
 *
 * PHASE 3 — rewritten to use the real, working data boundary. The
 * earlier version of this file read the full `ProgrammeSession`
 * document directly — confirmed, in an earlier round's own explicit
 * header comment here, to be rejected by Firestore's real rules
 * (wrong Firebase instance, and a rule that never recognized a
 * student's own identity at all). Neither problem is theoretical
 * anymore; both are fixed by this round's own approved architecture:
 *
 *   - This file now resolves its own per-slot Firestore instance
 *     (services/studentAuthService.js's own getFirestoreForSlot())
 *     instead of ever touching the teacher's default app.
 *   - It never reads the canonical ProgrammeSession document at all —
 *     only its own `studentEntries/{studentId}` slice, via a single,
 *     known-path getDoc(), matching this Phase's own explicit
 *     "known-document reads, never a query" requirement.
 *   - It resolves TODAY's own sessionId by computing it
 *     (services/programmeSessionService.js's own
 *     computeDeterministicSessionId()) rather than querying for it —
 *     the only way to satisfy "known-document reads" for session
 *     discovery itself, not just the StudentEntry read that follows
 *     it. See that function's own header comment for the full
 *     reasoning.
 *   - It ensures its own services/membershipLinkService.js link
 *     exists (self-attested, created transparently) before its first
 *     StudentEntry read — the exact moment that service's own header
 *     comment said a future Learning Circle screen would need to
 *     call it.
 *
 * WHAT'S DELIBERATELY NOT SOLVED HERE — "View Progress" across many
 * past sessions has no safe answer yet. A student can never be
 * granted a list/query capability over `programmeSessions` or
 * `studentEntries` (that's the whole boundary this Phase exists to
 * enforce), and there is no deterministic way to enumerate "which
 * past dates actually had a session" without one. Solving this
 * properly needs its own design (most likely a small, derived,
 * per-student rollup document, updated incrementally) — inventing
 * that now, unauthorized, would be exactly the kind of new
 * infrastructure this Phase's own process explicitly says to stop
 * and report rather than build. "View Progress" is disabled here,
 * honestly, with a message saying so — not silently hidden, not
 * faked with partial data.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as studentAuthService from '../../../services/studentAuthService.js';
import * as studentPortalDataService from '../../../services/studentPortalDataService.js';
import * as learningProgrammeService from '../../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../../services/programmeSessionService.js';
import * as membershipLinkService from '../../../services/membershipLinkService.js';
import * as firestoreStudentEntryRepository from '../../../repositories/firestoreStudentEntryRepository.js';
import { getEffectiveAttendanceStatus } from '../../components/ProgrammeSessionHelpers.js';
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
  const activeProfile = studentDeviceService.getActiveProfile();
  try {
    if (!activeProfile) {
      wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
      return;
    }
    // The classroom document's own read is unaffected by anything in
    // this Phase — it was already, deliberately, permissively
    // readable (see firestore.rules' own `classrooms/{classroomId}`
    // comment), which is exactly why a student's device can resolve
    // which programme they're in before ever touching a
    // per-slot instance at all.
    const loaded = await studentPortalDataService.loadCurrentStudentAndClassroom();
    if (!loaded) {
      wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
      return;
    }
    classroom = loaded.classroom;

    programme = learningProgrammeService
      .listLearningProgrammes(classroom)
      .find((p) => learningProgrammeService.getActiveMembership(p, activeProfile.studentId));

    if (!programme) {
      wrapper.appendChild(createEmptyStateElement({ message: "You're not part of a Learning Circle yet." }));
      return;
    }
  } catch (error) {
    console.error('[StudentLearningCircleView] Failed to load classroom/programme data:', error);
    wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
    return;
  }

  const studentId = activeProfile.studentId;

  const programmeTitle = document.createElement('h2');
  programmeTitle.className = 'student-learning-circle__programme-name';
  programmeTitle.textContent = programme.name;
  wrapper.appendChild(programmeTitle);

  const dateLine = document.createElement('p');
  dateLine.className = 'student-learning-circle__date';
  const todayDateKey = getTodayDateKey();
  dateLine.textContent = formatDateKey(todayDateKey);
  wrapper.appendChild(dateLine);

  // Resolve this device's own per-slot identity — the real,
  // authenticated uid a Firestore rule can actually check, never the
  // teacher's own default app instance.
  const slotIndex = studentDeviceService.getSlotForStudent(studentId);
  if (slotIndex === null) {
    wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
    return;
  }
  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  await studentAuthService.ensureAnonymousSignIn(slotIndex);

  // Self-attested membership link — created transparently, the first
  // time this device actually needs Learning Circle access, per that
  // service's own header comment. Idempotent: a no-op if it already
  // exists.
  try {
    await membershipLinkService.ensureMembershipLinkForCurrentStudent(classroom.id, programme.id);
  } catch (error) {
    console.error('[StudentLearningCircleView] Failed to establish membership link:', error);
    wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load your Learning Circle right now." }));
    return;
  }

  // The deterministic id — computed, never queried for. See this
  // file's own header comment, and computeDeterministicSessionId()'s
  // own, for the full reasoning.
  const sessionId = programmeSessionService.computeDeterministicSessionId(programme.id, todayDateKey);

  let entry = null;
  try {
    entry = await firestoreStudentEntryRepository.getStudentEntry(db, { classroomId: classroom.id, sessionId, studentId });
  } catch (error) {
    console.error('[StudentLearningCircleView] Failed to load today\u2019s entry:', error);
    wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load today's Learning Circle right now." }));
    appendProgressNotice(wrapper);
    container.appendChild(wrapper);
    return;
  }

  // TODAY — the student's own attendance, read-only from this screen
  // (a student never marks their own attendance; that remains a
  // teacher-only action, unchanged). No StudentEntry yet is honestly
  // ambiguous — it could mean the teacher hasn't started today's
  // session, or simply that nothing's been recorded for this student
  // yet; a student's own device has no way to distinguish those two
  // cases anymore, by design (see this file's own header comment) —
  // this is the shape of the boundary this Phase exists to enforce,
  // not something to paper over with a more confident-sounding
  // message than is actually true.
  const todayHeading = document.createElement('h3');
  todayHeading.className = 'profile-section__heading';
  todayHeading.textContent = 'TODAY';
  wrapper.appendChild(todayHeading);

  const effectiveAttendanceStatus = getEffectiveAttendanceStatus({ attendance: { [studentId]: entry?.attendance || null } }, studentId);
  const attendanceLine = document.createElement('p');
  attendanceLine.className = 'student-learning-circle__attendance-line';
  const display = ATTENDANCE_DISPLAY[effectiveAttendanceStatus];
  attendanceLine.textContent = `${display.icon} ${display.label}`;
  wrapper.appendChild(attendanceLine);

  // Your goals — a plain, local, in-memory "session-shaped" object
  // that recordGoal() (unchanged, generic — see
  // ui/components/ProgrammeGoalsControls.js's own header comment) can
  // mutate exactly as it always has; this is never sent anywhere
  // itself, only session.goals[studentId][categoryId] is, via
  // saveGoal() below.
  const goalsHeading = document.createElement('h3');
  goalsHeading.className = 'profile-section__heading';
  goalsHeading.textContent = 'Your goals';
  wrapper.appendChild(goalsHeading);

  const localSessionModel = { goals: { [studentId]: entry?.goals || {} }, updatedAt: null };

  const { element: saveIndicator, persistPatch } = createSaveIndicatorController(classroom.id, { id: sessionId, updatedAt: null });
  wrapper.appendChild(saveIndicator);

  function saveGoal(sId, categoryId) {
    return programmeSessionService.saveStudentOwnGoalPatch(db, {
      classroomId: classroom.id,
      sessionId,
      studentId: sId,
      categoryId,
      goal: localSessionModel.goals[sId][categoryId],
    });
  }

  const goalsContainer = document.createElement('div');
  wrapper.appendChild(goalsContainer);

  function redrawGoals() {
    goalsContainer.innerHTML = '';
    programme.configuration.goalFramework.categories.forEach((category) => {
      goalsContainer.appendChild(buildStudentGoalRow(programme, localSessionModel, studentId, category, persistPatch, redrawGoals, saveGoal));
    });
  }
  redrawGoals();

  appendProgressNotice(wrapper);
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
 * set.
 *
 * A student's own goal-setting is always available, regardless of
 * whether the teacher's own ProgrammeSession document exists for
 * today yet (see this file's own header comment for why that's
 * genuinely fine, not an oversight) — this row never gates on
 * "editable" the way the teacher-facing version does, since a
 * student's own StudentEntry can always be written for today's own
 * deterministic session id.
 */
function buildStudentGoalRow(programme, session, studentId, category, persistPatch, redraw, saveGoal) {
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
  } else {
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
    pickerContainer.appendChild(buildGoalPicker(programme, session, { id: studentId }, category, persistPatch, redraw, saveGoal));

    toggleButton.addEventListener('click', () => {
      pickerContainer.hidden = !pickerContainer.hidden;
      toggleButton.textContent = pickerContainer.hidden ? '\ud83d\udca1 Get Suggestions' : 'Hide Suggestions';
    });

    row.append(toggleButton, pickerContainer);
  }

  return row;
}

/**
 * PHASE 3 — "View Progress" is honestly disabled, not silently
 * removed and not faked with partial data. See this file's own
 * header comment for exactly why: there is no safe, list-query-free
 * way for a student's device to discover which past sessionIds
 * exist, and inventing one now would be new, unauthorized
 * infrastructure this round's own process explicitly says to stop
 * and report rather than build.
 */
function appendProgressNotice(wrapper) {
  const notice = document.createElement('p');
  notice.className = 'profile-section__meta';
  notice.textContent = 'Progress across past sessions isn\u2019t available yet \u2014 check back after this is added in a future update.';
  wrapper.appendChild(notice);
}
