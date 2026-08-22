/**
 * ui/components/ProgrammeAttendanceControls.js
 *
 * The interactive attendance section — extracted this round from
 * ui/views/ProgrammeSessionView.js specifically because a second
 * screen (ui/views/ProgrammeAttendanceView.js, the new "Mark
 * Attendance" drill-in destination) now needs the exact same
 * interaction, not a rebuilt copy of it. Nothing about the
 * interaction itself changed in this move — this is the same tap-
 * to-toggle Present/Absent control plus the secondary "⋮" sheet for
 * Late, unchanged since the prior UX-correction round.
 *
 * PATTERN — adapts, at an appropriate scale, the same pattern already
 * established by ui/components/ClassModeStudentRow.js (a fast,
 * primary tap action; a genuinely focusable secondary-actions entry
 * point, not a long-press-only one, specifically so keyboard/
 * assistive-tech users aren't excluded) and
 * ui/components/QuickActionsSheet.js (the reusable bottom-sheet shell
 * for secondary, less-frequent actions). Deliberately NOT a full
 * reuse of ClassModeStudentRow.js's own pointer-gesture machinery
 * (long-press timers, swipe-to-deduct dragging) — attendance has no
 * swipe gesture at all, and reproducing that machinery would be
 * unnecessary scope growth.
 *
 * PRESENT-BY-DEFAULT IS DISPLAY-ONLY, PER EXPLICIT PRODUCT DECISION —
 * see ui/components/ProgrammeSessionHelpers.js's own
 * getEffectiveAttendanceStatus()/hasRecordedAttendance() header
 * comments for the full reasoning (unchanged this round): no
 * attendance record is ever created just by opening or viewing a
 * session, and a read-only historical row never fabricates a status
 * for a student who was never actually recorded.
 */

import * as programmeSessionService from '../../services/programmeSessionService.js';
import { createStudentNameElement } from './StudentNameElement.js';
import {
  ATTENDANCE_STATUS_META,
  getEffectiveAttendanceStatus,
  hasRecordedAttendance,
  getToggledAttendanceStatus,
} from './ProgrammeSessionHelpers.js';

/**
 * PHASE 3.7 — `persistAttendance(studentId)` (optional) is used ONLY
 * when `session.usesStudentEntries` is true — it must persist BOTH
 * the teacher-canonical write AND the studentEntries mirror (see
 * services/programmeSessionService.js's own
 * saveAttendancePatchWithMirror()), which needs `classroomId` this
 * file is never given directly; the caller
 * (ui/views/ProgrammeAttendanceView.js) closes over it instead, the
 * same decoupling ui/components/ProgrammeGoalsControls.js's own
 * `goalWriter` already established. For a session with no
 * `usesStudentEntries` (everything created before this phase),
 * `persistAttendance` is never called — behaviour is 100% unchanged,
 * still `persistPatch(() => buildAttendancePatch(...))`.
 */
export function buildAttendanceSection(programme, session, roster, editable, persistPatch, persistAttendance) {
  const section = document.createElement('section');
  section.className = 'profile-section programme-session-view__section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Attendance';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'programme-session-view__attendance-list';

  roster.forEach(({ student, team }) => {
    list.appendChild(buildAttendanceRow(programme, session, student, team, editable, persistPatch, persistAttendance));
  });

  section.appendChild(list);
  return section;
}

function buildAttendanceRow(programme, session, student, team, editable, persistPatch, persistAttendance) {
  const row = document.createElement('div');
  row.className = 'programme-session-view__attendance-row';
  row.appendChild(createStudentNameElement({ student, team, leadingMarker: 'avatar', size: 32 }));

  const controls = document.createElement('div');
  controls.className = 'programme-session-view__attendance-controls';

  // A read-only (past) session with no actual recorded entry shows
  // an explicit "Not recorded" note, never the editable session's own
  // Present-by-default display convention.
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
   * actually records a status — mutates the session, persists via
   * the existing Phase 1.6 targeted-patch path, then repaints just
   * this one button directly (a local DOM update, never a full
   * section redraw, matching this app's own established
   * "never re-fetch from Firestore just to reflect a local mutation"
   * discipline).
   */
  async function setStatus(status) {
    programmeSessionService.recordAttendance(programme, session, { studentId: student.id, status });
    if (session.usesStudentEntries) {
      await persistAttendance(student.id);
    } else {
      await persistPatch(() => programmeSessionService.buildAttendancePatch(session, student.id));
    }
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
 * The secondary-action sheet — reached via the always-visible "⋮"
 * button above. Reuses ui/components/QuickActionsSheet.js's own
 * established `.sheet-overlay`/`.bottom-sheet` markup and open/close
 * animation sequence exactly, with new, small, attendance-specific
 * content — not that file's own Class-Mode-specific actions, and not
 * a change to that file itself.
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
