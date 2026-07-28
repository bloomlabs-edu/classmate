/**
 * services/debugModeService.js
 *
 * Gates developer-only diagnostics (raw extracted text, page-by-page
 * character counts, Table of Contents parsing failure detail) behind
 * a flag a normal teacher will never see or accidentally trigger. A
 * teacher's experience of Curriculum Import should only ever be
 * Upload -> Processing... -> Review Units -> Review Concepts ->
 * Publish — see ui/views/CurriculumManagementView.js.
 *
 * localStorage, not a URL query parameter, per explicit instruction:
 * a developer opening this app repeatedly shouldn't have to remember
 * to type `?debug=1` into the address bar every single time. Toggled
 * from a small "Developer Tools" screen (see
 * ui/views/DeveloperToolsView.js), reachable from Teacher Home —
 * present, but clearly not part of a teacher's normal flow.
 */

const STORAGE_KEY = 'classmate:debugMode';

export function isDebugModeEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch (error) {
    console.error('[debugModeService] Failed to read from localStorage:', error);
    return false;
  }
}

export function setDebugModeEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('[debugModeService] Failed to write to localStorage:', error);
  }
}
