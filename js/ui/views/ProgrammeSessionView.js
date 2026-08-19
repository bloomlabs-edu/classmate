/**
 * ui/views/ProgrammeSessionView.js
 *
 * "Today's Session" — the one screen this whole phase exists to
 * build: attendance, daily goals, activities, and teacher
 * observations for one ProgrammeSession. Also doubles as the
 * read-only viewer for any past session (see isSessionEditable()
 * below).
 *
 * DATA FLOW — followed exactly, per this project's own Phase 2A
 * authorization:
 *   VIEW -> services/programmeSessionService.js -> services/programmeSessionRepository.js -> Firestore
 * This view NEVER mutates `classroom` and NEVER calls
 * services/workspaceService.js's save() for anything on this screen
 * — ProgrammeSession data lives entirely in its own Firestore
 * subcollection (see services/programmeSessionRepository.js), with
 * its own persistence path, exactly as this phase's own
 * authorization requires ("Never: VIEW -> classroom object mutation
 * -> global classroom save"). Every per-student update goes through
 * the Phase 1.6 targeted-patch functions
 * (buildAttendancePatch()/buildGoalPatch()/buildTeacherObservationPatch())
 * + saveSessionPatch() — never a hand-built Firestore field path,
 * and never a full-field rewrite of `attendance`/`goals`/
 * `teacherObservations`.
 *
 * EDITABILITY — a session is only ever editable if it's today's
 * session for a still-active (non-archived) programme; anything else
 * (a past date, or the owning programme has since been archived)
 * renders read-only. This is a UI-level decision only — it does not
 * change, and does not need to change, anything about
 * services/programmeSessionService.js's own domain guards (a past
 * session was never blocked from being read there, and this view
 * doesn't ask it to be).
 *
 * LOADING — reopening this screen (including a second, third, ...
 * time on the same day) always loads the ALREADY-PERSISTED session
 * via getSessionById() and renders exactly what's there. Nothing here
 * regenerates goals from the programme's current suggestions, resets
 * attendance, or resets observations — the loaded session's own data
 * is authoritative, matching this project's own explicit "Historical
 * session state is authoritative" rule.
 *
 * TEACHER-SIDE UX CORRECTION (this round) — two changes to how this
 * screen presents itself, neither touching the underlying data model:
 *   1. Daily goals are STUDENT-OWNED, not teacher-assigned — the goal
 *      suggestion library must never be the first thing a category
 *      shows. See buildGoalDisclosure() (a new goal) and the "Edit
 *      Goal" action inside buildExistingGoalDisplay() (replacing one
 *      that already exists) — both keep the library behind an
 *      explicit action, never surfaced automatically.
 *   2. Attendance is now a single tap-to-toggle Present/Absent
 *      control per student, not three permanently-visible buttons —
 *      see this file's own "Section 1 — Attendance" header comment
 *      for the full reasoning, including why Present-by-default is
 *      display-only and never auto-written.
 * Explicitly NOT built this round, per its own approved scope: a
 * separate student-facing mode, and any Learning Programme presence
 * in Student Profile/Students Mode — both remain exactly as absent
 * from this codebase as before, pending their own future
 * authorization. Nothing below makes either of those harder to add
 * later: the goal/attendance data shapes are completely unchanged,
 * only this one screen's own presentation of them.
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import { createStudentNameElement } from '../components/StudentNameElement.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getTodayDateKey, formatDateKey } from '../../utils/dateHelpers.js';

const OUTCOME_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'partially_completed', label: 'Partially completed' },
  { value: 'try_again', label: 'Try again' },
];

// View-local, deliberately NOT part of the domain model — Phase 1.6's
// own default configuration (config/englishLiteracyCircleDefaults.js)
// has no stored "suggested activities" field at all (see this
// project's own Learning Programmes Audit Report §8: Attendance/
// Goals/Activities/Outcome/Reflection are structurally built into
// models/ProgrammeSession.js's own fixed fields, never modelled as
// configurable components). Adding one now would be redesigning that
// data model mid-UI-phase, which this project's own "mandatory stop
// condition" instruction says to flag rather than do silently. These
// are plain, static quick-fill suggestions for the "+ Add Activity"
// action below — purely a UI convenience; the actual recorded
// activity is always whatever text ends up in `activities[]` via
// recordActivity(), suggested or freely typed, exactly like a goal's
// own suggested/custom distinction.
const SUGGESTED_ACTIVITIES = ['Guided Reading', 'Partner Speaking', 'Vocabulary Game'];

/** Pure — a session is editable only if it's today's own session for a programme that hasn't been archived since. Exported so this exact decision is unit-testable without any DOM. */
export function isSessionEditable(session, programme) {
  return session.date === getTodayDateKey() && programme.status !== 'archived';
}

/**
 * Every student this session's own data already mentions — the
 * union of attendance/goal/observation keys — used for the read-only
 * roster of a past session, per this project's own Phase 1.6 Issue 5
 * decision NOT to store a separate participant-roster field (see
 * models/ProgrammeSession.js's own header comment): a session's own
 * recorded data IS its roster.
 */
export function getSessionParticipantIds(session) {
  const ids = new Set([
    ...Object.keys(session.attendance || {}),
    ...Object.keys(session.goals || {}),
    ...Object.keys(session.teacherObservations || {}),
  ]);
  return Array.from(ids);
}

export async function renderProgrammeSessionView(container, { classroom, programmeId, sessionId, onBack }) {
  container.innerHTML = '';

  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    container.appendChild(createEmptyStateElement({ message: 'This Learning Programme could not be found.' }));
    return;
  }

  const session = await programmeSessionService.getSessionById(classroom.id, sessionId);
  if (!session) {
    container.appendChild(createEmptyStateElement({ message: 'This session could not be found.' }));
    return;
  }

  const editable = isSessionEditable(session, programme);

  // The roster this screen actually works with: for an editable
  // (today's) session, every currently active member — a teacher
  // marking attendance needs to see everyone, including students with
  // no entry yet. For a read-only (past) session, only students the
  // session's own data already mentions (see
  // getSessionParticipantIds() above) — never the programme's CURRENT
  // membership list, which could have changed since.
  const allStudentsById = new Map(classroom.teams.flatMap((team) => team.students.map((student) => [student.id, { student, team }])));
  const rosterStudentIds = editable
    ? learningProgrammeService.getActiveMembers(programme).map((m) => m.studentId)
    : getSessionParticipantIds(session);
  const roster = rosterStudentIds.map((studentId) => allStudentsById.get(studentId)).filter(Boolean);

  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view';

  wrapper.appendChild(buildHeader(programme, session, roster, editable, onBack));

  const saveIndicator = document.createElement('div');
  saveIndicator.className = 'programme-session-view__save-indicator';
  wrapper.appendChild(saveIndicator);

  function setSaveIndicator(status) {
    saveIndicator.innerHTML = '';
    if (status === 'idle') return;
    const text = document.createElement('span');
    if (status === 'saving') {
      text.className = 'learning-management__save-indicator learning-management__save-indicator--saving';
      text.textContent = 'Saving\u2026';
    } else if (status === 'saved') {
      text.className = 'learning-management__save-indicator learning-management__save-indicator--saved';
      text.textContent = '\u2713 Changes saved';
    } else if (status === 'error') {
      text.className = 'learning-management__save-indicator learning-management__save-indicator--failed';
      text.textContent = 'Save failed. Check your connection and try again.';
    }
    saveIndicator.appendChild(text);
  }

  /**
   * The one place every per-student save in this view goes through —
   * calls the given build*Patch() function, persists it via
   * saveSessionPatch(), and drives the Saving/Saved/Error indicator.
   * Deliberately a thin wrapper, not a new persistence mechanism:
   * services/programmeSessionService.js's own patch builders and
   * saveSessionPatch() do all the real work; this only sequences the
   * indicator around that existing call.
   *
   * Returns whether the save actually succeeded — callers use this to
   * decide whether it's safe to redraw() (see that function's own
   * comment for exactly why this matters). Deliberately still never
   * re-throws: a failed save should leave the teacher looking at
   * their own just-made, still-correct local change with a visible
   * "Save failed" indicator, not an uncaught rejection.
   */
  async function persistPatch(buildPatch) {
    setSaveIndicator('saving');
    try {
      const patch = buildPatch();
      await programmeSessionService.saveSessionPatch(classroom.id, session.id, patch);
      setSaveIndicator('saved');
      return true;
    } catch (error) {
      console.error('[ProgrammeSessionView] Failed to save:', error);
      setSaveIndicator('error');
      return false;
    }
  }

  const sectionsContainer = document.createElement('div');
  wrapper.appendChild(sectionsContainer);

  /**
   * BUG FIX (Phase 2A verification round) — rebuilds only the section
   * markup, from the CURRENT in-memory `session`/`programme`/`roster`
   * state, and does NOT touch Firestore. This replaces an earlier
   * version of this file where every goal/activity/observation
   * handler called a `rerender()` that re-invoked this whole exported
   * function — including a fresh getSessionById() Firestore read —
   * after every single edit, regardless of whether the just-attempted
   * save had actually succeeded.
   *
   * The concrete bug that produced: recordGoal()/recordActivity()/
   * recordTeacherObservation() each mutate the local `session` object
   * synchronously, BEFORE the async persistPatch() call even starts —
   * so the local, in-memory `session` is always already correct the
   * instant a teacher acts, independent of whether the network write
   * later succeeds. But re-fetching from Firestore right after — as
   * the old rerender() did, unconditionally — could return whatever
   * the server still had on a slow connection or a genuinely failed
   * write (persistPatch() deliberately swallows the error rather than
   * throwing, so nothing stopped that re-fetch from running), silently
   * discarding the teacher's own just-made, correct local edit and
   * replacing it with stale server data — the same class of problem
   * this project's own "detect accidental full-object replacement"
   * verification step exists to catch, just via a fresh read instead
   * of a full-object write.
   *
   * redraw() cannot have this problem by construction: it never asks
   * Firestore anything. It only re-renders `sectionsContainer` from
   * whatever `session`/`programme`/`roster` already hold in memory —
   * which already reflects every local mutation, saved or not. A
   * genuine full page reload (a real browser refresh, not this
   * in-page action) still goes through the exported function above
   * and gets a fresh, correct server read, exactly as before; only
   * the in-page, post-edit refresh path changed.
   */
  function redraw() {
    sectionsContainer.innerHTML = '';

    if (roster.length === 0) {
      sectionsContainer.appendChild(
        createEmptyStateElement({
          message: editable ? 'No active members yet \u2014 add students from Settings to begin.' : 'No students were recorded in this session.',
        })
      );
      sectionsContainer.appendChild(buildActivitiesSection(session, editable, persistPatch, redraw));
      return;
    }

    sectionsContainer.appendChild(buildAttendanceSection(programme, session, roster, editable, persistPatch));
    sectionsContainer.appendChild(buildGoalsSection(programme, session, roster, editable, persistPatch, redraw));
    sectionsContainer.appendChild(buildActivitiesSection(session, editable, persistPatch, redraw));
    sectionsContainer.appendChild(buildObservationsSection(programme, session, roster, editable, persistPatch, redraw));
  }

  redraw();
  container.appendChild(wrapper);
}

function buildHeader(programme, session, roster, editable, onBack) {
  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));

  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = programme.name;
  titleBlock.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  const dateText = formatDateKey(session.date);
  subtitle.textContent = `${dateText} \u00b7 ${roster.length} student${roster.length === 1 ? '' : 's'}${editable ? '' : ' \u00b7 Read-only'}`;
  titleBlock.appendChild(subtitle);

  header.appendChild(titleBlock);
  return header;
}

// ---------------------------------------------------------------------
// Section 1 — Attendance
// ---------------------------------------------------------------------
//
// PHASE 2A UX CORRECTION — replaced the original three-permanently-
// visible-buttons-per-student layout with a single tap-to-toggle
// status control (Present \u2194 Absent, the fast, primary interaction a
// teacher needs while taking attendance on a phone) plus a small,
// always-visible "\u22ee" affordance opening a minimal secondary sheet for
// Late and explicit corrections \u2014 adapting, at an appropriate scale,
// the same pattern already established by
// ui/components/ClassModeStudentRow.js (a fast, primary tap action;
// a genuinely focusable secondary-actions entry point, not a
// long-press-only one, specifically so keyboard/assistive-tech users
// aren't excluded) and ui/components/QuickActionsSheet.js (the
// reusable bottom-sheet shell for secondary, less-frequent actions).
// Deliberately NOT a full reuse of ClassModeStudentRow.js's own
// pointer-gesture machinery (long-press timers, swipe-to-deduct
// dragging) \u2014 none of that machinery is needed here (attendance has
// no swipe gesture at all), and reproducing it would be exactly the
// kind of scope growth this round's own "small, controlled changes"
// instruction asked to avoid. What's reused is the PATTERN (fast tap
// + visible secondary affordance + bottom sheet), not the unrelated
// gesture code.
//
// PRESENT-BY-DEFAULT IS DISPLAY-ONLY, PER EXPLICIT PRODUCT DECISION:
// getEffectiveAttendanceStatus() below returns 'present' whenever
// `session.attendance[studentId]` doesn't exist yet \u2014 this is a pure
// read, never a write. No attendance record is ever created just by
// opening or viewing a session; a real record is written only the
// instant a teacher actually taps the status control or explicitly
// picks an option from the secondary sheet. This matches every other
// sparse-record convention already established in this app (a Goal,
// a StudentCheckpointRecord, a ProgrammeMembership \u2014 none of these
// exist until something genuinely happens) and was an explicit,
// deliberate choice over the alternative (writing an implicit
// "present" entry for every roster member the moment a session
// opens), made because it's the smaller, more reversible option and
// because nothing yet built (attendance-percentage reporting is not
// part of this phase) depends on every student having an explicit
// entry.

const ATTENDANCE_STATUS_META = {
  present: { label: 'Present', icon: '\ud83d\udfe2' },
  absent: { label: 'Absent', icon: '\ud83d\udd34' },
  late: { label: 'Late', icon: '\ud83d\udfe1' },
};

/**
 * Pure — the status this screen actually displays for a student,
 * defaulting to 'present' whenever nothing has been recorded yet.
 * Exported so this exact default-vs-recorded distinction is
 * unit-testable without any DOM. NEVER writes anything — see this
 * section's own header comment for why the default must stay
 * display-only.
 *
 * This default is only ever appropriate for an EDITABLE (today's own)
 * session — see buildAttendanceRow() below, which only calls this for
 * that case. For a read-only, historical session, defaulting an
 * unrecorded student to "Present" would misrepresent what actually
 * happened (nobody confirmed it), directly conflicting with this
 * project's own repeated "historical session data is a record of
 * what happened, never inferred" principle — a read-only row with no
 * recorded status shows an explicit "Not recorded" state instead (see
 * hasRecordedAttendance() below), never this function's own default.
 */
export function getEffectiveAttendanceStatus(session, studentId) {
  return session.attendance[studentId]?.status || 'present';
}

/** Pure — whether this student has an actual, explicit attendance entry in this session, as opposed to never having been recorded at all. */
export function hasRecordedAttendance(session, studentId) {
  return Boolean(session.attendance[studentId]);
}

/**
 * Pure \u2014 what the primary, one-tap control should set a student's
 * status to next. The fast path is always exactly Present \u2194 Absent;
 * tapping while a student shows as 'late' resolves them back to
 * 'present' (Late is only ever set/cleared explicitly, via the
 * secondary sheet \u2014 see openAttendanceOptionsSheet() below \u2014 never
 * cycled through by the primary tap, which stays a fast two-state
 * toggle exactly as required).
 */
export function getToggledAttendanceStatus(currentStatus) {
  return currentStatus === 'present' ? 'absent' : 'present';
}

function buildAttendanceSection(programme, session, roster, editable, persistPatch) {
  const section = document.createElement('section');
  section.className = 'profile-section programme-session-view__section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Attendance';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'programme-session-view__attendance-list';

  roster.forEach(({ student, team }) => {
    list.appendChild(buildAttendanceRow(programme, session, student, team, editable, persistPatch));
  });

  section.appendChild(list);
  return section;
}

function buildAttendanceRow(programme, session, student, team, editable, persistPatch) {
  const row = document.createElement('div');
  row.className = 'programme-session-view__attendance-row';
  row.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

  const controls = document.createElement('div');
  controls.className = 'programme-session-view__attendance-controls';

  // A read-only (past) session with no actual recorded entry shows
  // an explicit "Not recorded" note, never the editable session's own
  // Present-by-default display convention — see
  // getEffectiveAttendanceStatus()'s own header comment for exactly
  // why defaulting here would misrepresent history.
  if (!editable && !hasRecordedAttendance(session, student.id)) {
    const notRecorded = document.createElement('span');
    notRecorded.className = 'profile-section__meta';
    notRecorded.textContent = 'Not recorded';
    controls.appendChild(notRecorded);
    row.appendChild(controls);
    return row;
  }

  const statusButton = document.createElement('button');
  statusButton.type = 'button';
  statusButton.disabled = !editable;

  function paintStatus(status) {
    const meta = ATTENDANCE_STATUS_META[status];
    statusButton.className = `programme-session-view__attendance-status-toggle programme-session-view__attendance-status-toggle--${status}`;
    statusButton.textContent = `${meta.icon} ${meta.label}`;
    statusButton.setAttribute('aria-label', `${student.name}: ${meta.label}. Tap to toggle Present or Absent.`);
  }

  paintStatus(getEffectiveAttendanceStatus(session, student.id));

  /**
   * The one place either the primary tap or a secondary-sheet choice
   * actually records a status \u2014 mutates the session, persists via
   * the existing Phase 1.6 targeted-patch path, then repaints just
   * this one button directly. Deliberately a local DOM update, not a
   * call to the outer redraw(): this mirrors the exact, already-safe
   * pattern this section used before this round (see this file's own
   * "BUG FIX" comment on redraw() for why an unnecessary full-section
   * rebuild is avoided here), and there is even less reason to invite
   * one now, since nothing about this specific edit needs any other
   * row or section to change at all.
   */
  async function setStatus(status) {
    programmeSessionService.recordAttendance(programme, session, { studentId: student.id, status });
    await persistPatch(() => programmeSessionService.buildAttendancePatch(session, student.id));
    paintStatus(status);
  }

  statusButton.addEventListener('click', () => {
    if (!editable) return;
    setStatus(getToggledAttendanceStatus(getEffectiveAttendanceStatus(session, student.id)));
  });

  controls.appendChild(statusButton);

  if (editable) {
    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'btn btn--icon-only programme-session-view__attendance-more-button';
    moreButton.setAttribute('aria-label', `More attendance options for ${student.name}`);
    moreButton.textContent = '\u22ee';
    moreButton.addEventListener('click', () => {
      openAttendanceOptionsSheet({
        student,
        currentStatus: getEffectiveAttendanceStatus(session, student.id),
        onSelectStatus: setStatus,
      });
    });
    controls.appendChild(moreButton);
  }

  row.appendChild(controls);
  return row;
}

/**
 * The secondary-action sheet \u2014 reached via the always-visible "\u22ee"
 * button above (see this section's own header comment for exactly
 * why this isn't long-press-only). Reuses
 * ui/components/QuickActionsSheet.js's own established
 * `.sheet-overlay`/`.bottom-sheet` markup and open/close animation
 * sequence exactly (build hidden \u2192 append to document \u2192
 * requestAnimationFrame to add the `--visible` classes so the CSS
 * transition actually animates in; remove `--visible` then a matching
 * setTimeout before detaching, so the transition-out finishes first)
 * for visual consistency with every other sheet in this app, with new,
 * small, attendance-specific content \u2014 not that file's own
 * Class-Mode-specific actions, and not a change to that file itself.
 */
function openAttendanceOptionsSheet({ student, currentStatus, onSelectStatus }) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', `Attendance for ${student.name}`);

  function close() {
    overlay.classList.remove('sheet-overlay--visible');
    sheet.classList.remove('bottom-sheet--visible');
    setTimeout(() => overlay.remove(), 200);
  }

  const handle = document.createElement('div');
  handle.className = 'bottom-sheet__handle';

  const name = document.createElement('h2');
  name.className = 'bottom-sheet__name';
  name.textContent = student.name;

  const actionsList = document.createElement('div');
  actionsList.className = 'bottom-sheet__actions';

  Object.entries(ATTENDANCE_STATUS_META).forEach(([value, meta]) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = `bottom-sheet__action${value === currentStatus ? ' programme-session-view__attendance-sheet-option--active' : ''}`;
    const iconSpan = document.createElement('span');
    iconSpan.className = 'bottom-sheet__action-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = meta.icon;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = value === currentStatus ? `${meta.label} (current)` : meta.label;
    optionButton.append(iconSpan, labelSpan);
    optionButton.addEventListener('click', () => {
      close();
      onSelectStatus(value);
    });
    actionsList.appendChild(optionButton);
  });

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'bottom-sheet__cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  sheet.append(handle, name, actionsList, cancelButton);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('sheet-overlay--visible');
    sheet.classList.add('bottom-sheet--visible');
  });
}


// ---------------------------------------------------------------------
// Section 2 — Daily Goals
// ---------------------------------------------------------------------

function buildGoalsSection(programme, session, roster, editable, persistPatch, redraw) {
  const section = document.createElement('section');
  section.className = 'profile-section programme-session-view__section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Daily Goals';
  section.appendChild(heading);

  const categories = programme.configuration.goalFramework.categories;

  roster.forEach(({ student, team }) => {
    const studentBlock = document.createElement('div');
    studentBlock.className = 'programme-session-view__goal-student-block';

    studentBlock.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

    const categoryList = document.createElement('div');
    categoryList.className = 'programme-session-view__goal-category-list';

    // Only categories with an existing goal are shown for a
    // read-only (past) session, matching "historical session data
    // preserves the actual goal text" — no empty category prompts
    // are ever shown for history that never recorded one.
    const relevantCategories = editable ? categories : categories.filter((c) => session.goals[student.id]?.[c.id]);

    relevantCategories.forEach((category) => {
      categoryList.appendChild(buildGoalCategoryRow(programme, session, student, category, editable, persistPatch, redraw));
    });

    if (relevantCategories.length === 0) {
      const noneNote = document.createElement('p');
      noneNote.className = 'profile-section__meta';
      noneNote.textContent = 'No goal recorded.';
      categoryList.appendChild(noneNote);
    }

    studentBlock.appendChild(categoryList);
    section.appendChild(studentBlock);
  });

  return section;
}

function buildGoalCategoryRow(programme, session, student, category, editable, persistPatch, redraw) {
  const row = document.createElement('div');
  row.className = 'programme-session-view__goal-category-row';

  const categoryLabel = document.createElement('span');
  categoryLabel.className = 'programme-session-view__goal-category-label';
  categoryLabel.textContent = category.name;
  row.appendChild(categoryLabel);

  const existingGoal = session.goals[student.id]?.[category.id] || null;

  if (existingGoal) {
    row.appendChild(buildExistingGoalDisplay(programme, session, student, category, existingGoal, editable, persistPatch, redraw));
  } else if (editable) {
    row.appendChild(buildGoalDisclosure(programme, session, student, category, persistPatch, redraw));
  } else {
    const noneText = document.createElement('span');
    noneText.className = 'profile-section__meta';
    noneText.textContent = 'Not set';
    row.appendChild(noneText);
  }

  return row;
}

/**
 * Collapsed by default — the daily goal is the STUDENT's own choice,
 * not a teacher assignment (per this project's own explicit product
 * direction), so the goal library must never be the first thing shown
 * for a category with no goal yet. Shows only a small "\ud83d\udca1 Suggestions"
 * toggle; tapping it reveals the existing picker (buildGoalPicker()
 * below, unchanged internally — the same suggested-goal buttons plus
 * the same "write my own" field) inline, in place.
 *
 * The expand/collapse toggle itself is a purely local DOM change — it
 * never calls persistPatch() or redraw(), since nothing about session
 * data changes just by looking at the suggestions. Only actually
 * picking a suggested goal or setting a custom one (inside the
 * revealed buildGoalPicker()) touches persistence, exactly as before.
 * One accepted trade-off, stated plainly rather than silently
 * absorbed: because redraw() rebuilds this row from scratch, an open
 * disclosure collapses back if some OTHER, unrelated edit elsewhere
 * on the screen triggers a full redraw() (e.g. setting a different
 * student's own goal) — the same "transient local UI state doesn't
 * survive a full section rebuild" characteristic this file's own
 * attendance status highlighting already had before this round, not
 * a new regression, and not fixed here per this round's own "small,
 * controlled changes" scope.
 */
function buildGoalDisclosure(programme, session, student, category, persistPatch, redraw) {
  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view__goal-disclosure';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'btn btn--text programme-session-view__goal-suggestions-toggle';
  toggleButton.textContent = '\ud83d\udca1 Suggestions';

  const pickerContainer = document.createElement('div');
  pickerContainer.hidden = true;
  pickerContainer.appendChild(buildGoalPicker(programme, session, student, category, persistPatch, redraw));

  toggleButton.addEventListener('click', () => {
    pickerContainer.hidden = !pickerContainer.hidden;
    toggleButton.textContent = pickerContainer.hidden ? '\ud83d\udca1 Suggestions' : 'Hide Suggestions';
  });

  wrapper.append(toggleButton, pickerContainer);
  return wrapper;
}

/**
 * The suggested-goal / write-my-own picker itself — unchanged
 * internally from before this round. Never shown directly anymore;
 * always reached through an explicit disclosure (buildGoalDisclosure()
 * for a brand-new goal, or the "Edit Goal" toggle inside
 * buildExistingGoalDisplay() for replacing one that already exists).
 */
function buildGoalPicker(programme, session, student, category, persistPatch, redraw) {
  const picker = document.createElement('div');
  picker.className = 'programme-session-view__goal-picker';

  (category.suggestedGoals || []).forEach((suggestedText) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'btn btn--ghost programme-session-view__goal-option';
    optionButton.textContent = suggestedText;
    optionButton.addEventListener('click', async () => {
      programmeSessionService.recordGoal(programme, session, {
        studentId: student.id,
        categoryId: category.id,
        text: suggestedText,
        source: 'suggested',
      });
      await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
      redraw();
    });
    picker.appendChild(optionButton);
  });

  const customRow = document.createElement('div');
  customRow.className = 'programme-session-view__goal-custom-row';
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'modal__input programme-session-view__goal-custom-input';
  customInput.placeholder = 'Write my own goal\u2026';
  const customButton = document.createElement('button');
  customButton.type = 'button';
  customButton.className = 'btn btn--secondary';
  customButton.textContent = 'Set Goal';
  customButton.addEventListener('click', async () => {
    const text = customInput.value.trim();
    if (!text) return;
    programmeSessionService.recordGoal(programme, session, {
      studentId: student.id,
      categoryId: category.id,
      text,
      source: 'custom',
    });
    await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
    redraw();
  });
  customRow.append(customInput, customButton);
  picker.appendChild(customRow);

  return picker;
}

/**
 * An already-recorded goal — its own permanent text/source, plus
 * outcome + reflection, which remain editable even in an otherwise-
 * editable session's own goal (outcome is recorded after the fact).
 *
 * Also carries the "Edit Goal" action (editable sessions only) —
 * per this project's own product direction, a teacher may edit a
 * student's own goal when necessary, but the goal library must stay
 * behind an explicit action even then ("Edit Goal \u2192 Suggestions"),
 * never surfaced automatically alongside the goal itself. Tapping
 * "Edit Goal" reveals the same picker used for a brand-new goal
 * (buildGoalPicker(), unchanged) so the teacher can pick a different
 * suggestion or write a new custom goal; recordGoal() already
 * replaces rather than duplicates a goal for the same student/category
 * (this exact behaviour is covered by an existing, passing Phase 1.6
 * unit test), so choosing a new goal here safely overwrites the one
 * shown, and the next redraw() shows the replacement in its place —
 * the edit picker collapses back naturally, since a freshly-redrawn
 * row starts collapsed again by construction.
 */
function buildExistingGoalDisplay(programme, session, student, category, goal, editable, persistPatch, redraw) {
  const container = document.createElement('div');

  const display = document.createElement('div');
  display.className = 'programme-session-view__goal-display';

  const textEl = document.createElement('p');
  textEl.className = 'programme-session-view__goal-text';
  textEl.textContent = goal.text;
  const sourceTag = document.createElement('span');
  sourceTag.className = 'programme-session-view__goal-source';
  sourceTag.textContent = goal.source === 'suggested' ? '(suggested)' : '(own goal)';
  textEl.appendChild(sourceTag);
  display.appendChild(textEl);

  const outcomeGroup = document.createElement('div');
  outcomeGroup.className = 'programme-session-view__goal-outcome-group';
  OUTCOME_OPTIONS.forEach(({ value, label }) => {
    const outcomeButton = document.createElement('button');
    outcomeButton.type = 'button';
    outcomeButton.className = `btn btn--secondary programme-session-view__goal-outcome-button${
      goal.outcome === value ? ' programme-session-view__goal-outcome-button--active' : ''
    }`;
    outcomeButton.textContent = label;
    outcomeButton.disabled = !editable;
    outcomeButton.addEventListener('click', async () => {
      programmeSessionService.recordGoalOutcome(session, { studentId: student.id, categoryId: category.id, outcome: value });
      await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
      redraw();
    });
    outcomeGroup.appendChild(outcomeButton);
  });
  display.appendChild(outcomeGroup);

  const reflectionLabel = document.createElement('label');
  reflectionLabel.className = 'programme-session-view__goal-reflection-label';
  reflectionLabel.textContent = 'Reflection';
  const reflectionInput = document.createElement('textarea');
  reflectionInput.className = 'modal__input';
  reflectionInput.rows = 1;
  reflectionInput.value = goal.reflection || '';
  reflectionInput.disabled = !editable;
  reflectionLabel.appendChild(reflectionInput);
  display.appendChild(reflectionLabel);

  if (editable) {
    const saveReflectionButton = document.createElement('button');
    saveReflectionButton.type = 'button';
    saveReflectionButton.className = 'btn btn--text';
    saveReflectionButton.textContent = 'Save Reflection';
    saveReflectionButton.addEventListener('click', async () => {
      programmeSessionService.recordGoalOutcome(session, { studentId: student.id, categoryId: category.id, reflection: reflectionInput.value.trim() });
      await persistPatch(() => programmeSessionService.buildGoalPatch(session, student.id, category.id));
    });
    display.appendChild(saveReflectionButton);
  }

  container.appendChild(display);

  if (editable) {
    const editRow = document.createElement('div');
    editRow.className = 'programme-session-view__goal-edit-row';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--text';
    editButton.textContent = 'Edit Goal';

    const editPickerContainer = document.createElement('div');
    editPickerContainer.hidden = true;
    editPickerContainer.appendChild(buildGoalPicker(programme, session, student, category, persistPatch, redraw));

    editButton.addEventListener('click', () => {
      editPickerContainer.hidden = !editPickerContainer.hidden;
      editButton.textContent = editPickerContainer.hidden ? 'Edit Goal' : 'Cancel';
    });

    editRow.append(editButton, editPickerContainer);
    container.appendChild(editRow);
  }

  return container;
}

// ---------------------------------------------------------------------
// Section 3 — Activities
// ---------------------------------------------------------------------

function buildActivitiesSection(session, editable, persistPatch, redraw) {
  const section = document.createElement('section');
  section.className = 'profile-section programme-session-view__section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Activities';
  section.appendChild(heading);

  if (session.activities.length === 0) {
    const noneNote = document.createElement('p');
    noneNote.className = 'profile-section__meta';
    noneNote.textContent = 'No activities recorded yet.';
    section.appendChild(noneNote);
  } else {
    const list = document.createElement('div');
    list.className = 'programme-session-view__activity-list';
    session.activities.forEach((activity) => {
      const chip = document.createElement('span');
      chip.className = 'programme-session-view__activity-chip';
      chip.textContent = activity.notes ? `${activity.name} \u2014 ${activity.notes}` : activity.name;
      list.appendChild(chip);
    });
    section.appendChild(list);
  }

  if (editable) {
    const addRow = document.createElement('div');
    addRow.className = 'programme-session-view__add-activity-row';

    SUGGESTED_ACTIVITIES.forEach((name) => {
      const quickButton = document.createElement('button');
      quickButton.type = 'button';
      quickButton.className = 'btn btn--ghost';
      quickButton.textContent = name;
      quickButton.addEventListener('click', async () => {
        programmeSessionService.recordActivity(session, { name });
        await persistPatch(() => ({ activities: session.activities, updatedAt: session.updatedAt }));
        redraw();
      });
      addRow.appendChild(quickButton);
    });

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'modal__input';
    customInput.placeholder = '+ Add Activity';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--secondary';
    addButton.textContent = 'Add';
    addButton.addEventListener('click', async () => {
      const name = customInput.value.trim();
      if (!name) return;
      programmeSessionService.recordActivity(session, { name });
      await persistPatch(() => ({ activities: session.activities, updatedAt: session.updatedAt }));
      redraw();
    });
    addRow.append(customInput, addButton);
    section.appendChild(addRow);
  }

  return section;
}

// ---------------------------------------------------------------------
// Section 4 — Teacher Observations
// ---------------------------------------------------------------------

function buildObservationsSection(programme, session, roster, editable, persistPatch, redraw) {
  const section = document.createElement('section');
  section.className = 'profile-section programme-session-view__section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Teacher Observations';
  section.appendChild(heading);

  roster.forEach(({ student, team }) => {
    const studentBlock = document.createElement('div');
    studentBlock.className = 'programme-session-view__observation-student-block';
    studentBlock.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

    const existing = session.teacherObservations[student.id] || [];
    if (existing.length > 0) {
      const list = document.createElement('ul');
      list.className = 'programme-session-view__observation-list';
      existing.forEach((observation) => {
        const item = document.createElement('li');
        item.textContent = observation.note;
        list.appendChild(item);
      });
      studentBlock.appendChild(list);
    }

    if (editable) {
      const addRow = document.createElement('div');
      addRow.className = 'programme-session-view__add-observation-row';
      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'modal__input';
      noteInput.placeholder = 'Add an observation\u2026';
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn btn--secondary';
      addButton.textContent = 'Add';
      addButton.addEventListener('click', async () => {
        const note = noteInput.value.trim();
        if (!note) return;
        programmeSessionService.recordTeacherObservation(programme, session, { studentId: student.id, note });
        // Targeted patch — this student's own full observations
        // array only (see buildTeacherObservationPatch()'s own header
        // comment for why array-level, not per-entry, is the correct
        // granularity here); every other student's own observations
        // are untouched at the Firestore level.
        await persistPatch(() => programmeSessionService.buildTeacherObservationPatch(session, student.id));
        redraw();
      });
      addRow.append(noteInput, addButton);
      studentBlock.appendChild(addRow);
    }

    section.appendChild(studentBlock);
  });

  return section;
}
