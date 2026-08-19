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

const ATTENDANCE_STATUSES = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
];

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
    const row = document.createElement('div');
    row.className = 'programme-session-view__attendance-row';
    row.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

    const statusGroup = document.createElement('div');
    statusGroup.className = 'programme-session-view__attendance-status-group';

    const currentStatus = session.attendance[student.id]?.status || null;

    ATTENDANCE_STATUSES.forEach(({ value, label }) => {
      const statusButton = document.createElement('button');
      statusButton.type = 'button';
      statusButton.className = `btn btn--secondary programme-session-view__attendance-status-button${
        currentStatus === value ? ' programme-session-view__attendance-status-button--active' : ''
      }`;
      statusButton.textContent = label;
      statusButton.disabled = !editable;
      statusButton.addEventListener('click', async () => {
        programmeSessionService.recordAttendance(programme, session, { studentId: student.id, status: value });
        // Targeted patch — touches only this one student's own
        // `attendance.<studentId>` field (see
        // services/programmeSessionService.js's own
        // buildAttendancePatch()), never the whole attendance map.
        await persistPatch(() => programmeSessionService.buildAttendancePatch(session, student.id));
        statusGroup.querySelectorAll('.programme-session-view__attendance-status-button').forEach((btn) => {
          btn.classList.remove('programme-session-view__attendance-status-button--active');
        });
        statusButton.classList.add('programme-session-view__attendance-status-button--active');
      });
      statusGroup.appendChild(statusButton);
    });

    row.appendChild(statusGroup);
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
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
    row.appendChild(buildGoalPicker(programme, session, student, category, persistPatch, redraw));
  } else {
    const noneText = document.createElement('span');
    noneText.className = 'profile-section__meta';
    noneText.textContent = 'Not set';
    row.appendChild(noneText);
  }

  return row;
}

/** The suggested-goal / write-my-own picker — shown only for a category with no goal recorded yet in this session. */
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

/** An already-recorded goal — its own permanent text/source, plus outcome + reflection, which remain editable even in an otherwise-editable session's own goal (outcome is recorded after the fact). */
function buildExistingGoalDisplay(programme, session, student, category, goal, editable, persistPatch, redraw) {
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

  return display;
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
