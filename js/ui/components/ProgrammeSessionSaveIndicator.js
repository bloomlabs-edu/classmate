/**
 * ui/components/ProgrammeSessionSaveIndicator.js
 *
 * The Saving/Saved/Error indicator plus the persistPatch() wrapper it
 * drives — extracted this round because four screens now need the
 * exact same one (the dashboard overview and its three drill-ins:
 * Attendance, Goals, Observations), not four separate copies of it.
 *
 * Reuses the existing `learning-management__save-indicator*` text/
 * CSS convention already established elsewhere in this app (see
 * ui/views/LearningManagementView.js's own renderSaveStatus()) —
 * visually and textually, not the underlying tracked state, which is
 * necessarily different: that convention tracks the CLASSROOM
 * document's own dirty/saving/saved status (via
 * services/workspaceService.js), which ProgrammeSession data never
 * goes through at all (see services/programmeSessionRepository.js's
 * own header comment) — this tracks one specific patch-write promise
 * instead.
 *
 * persistPatch() deliberately never re-throws — a failed save leaves
 * the caller looking at their own just-made, still-correct local
 * change (every recordAttendance()/recordGoal()/recordActivity()/
 * recordTeacherObservation() call mutates its session object
 * synchronously, before this function's own async write is even
 * attempted) with a visible "Save failed" indicator, not an uncaught
 * rejection. Returns whether the save actually succeeded, in case a
 * caller wants to know, but no current caller in this app needs to
 * branch on it — see ui/views/ProgrammeSessionView.js's own "BUG FIX"
 * history for why a full section rebuild must never depend on this
 * value at all (a local, in-memory redraw is always safe regardless).
 */

import * as programmeSessionService from '../../services/programmeSessionService.js';

export function createSaveIndicatorController(classroomId, session) {
  const element = document.createElement('div');
  element.className = 'programme-session-view__save-indicator';

  function setStatus(status) {
    element.innerHTML = '';
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
    element.appendChild(text);
  }

  async function persistPatch(buildPatch) {
    setStatus('saving');
    try {
      const patch = buildPatch();
      await programmeSessionService.saveSessionPatch(classroomId, session.id, patch);
      setStatus('saved');
      return true;
    } catch (error) {
      console.error('[ProgrammeSessionSaveIndicator] Failed to save:', error);
      setStatus('error');
      return false;
    }
  }

  return { element, persistPatch };
}
