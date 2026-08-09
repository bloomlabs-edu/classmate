/**
 * ui/developer/StudentAuthSlotDiagnostic.js
 *
 * TEMPORARY — Milestone 1A verification only. Delete this whole file,
 * and its one call site in main.js, once Milestone 1A is confirmed
 * working in a real browser. Nothing else in the app depends on it;
 * removing it changes no real behavior.
 *
 * Shows, for the currently active student profile: which slot it
 * occupies, that slot's own Firebase Auth state, and its anonymous
 * UID — plus all three slots' own UIDs side by side, so switching
 * between the three existing student profiles can be visually
 * confirmed to produce three distinct, stable UIDs.
 */

import * as studentDeviceService from '../../services/studentDeviceService.js';
import * as studentAuthService from '../../services/studentAuthService.js';

let panelEl = null;
let unwatchFns = [];

export function renderStudentAuthSlotDiagnostic() {
  if (panelEl) {
    refresh();
    return;
  }

  panelEl = document.createElement('div');
  panelEl.id = 'student-auth-slot-diagnostic';
  panelEl.style.position = 'fixed';
  panelEl.style.bottom = '12px';
  panelEl.style.right = '12px';
  panelEl.style.zIndex = '99999';
  panelEl.style.background = '#1a1a1a';
  panelEl.style.color = '#0f0';
  panelEl.style.fontFamily = 'monospace';
  panelEl.style.fontSize = '11px';
  panelEl.style.padding = '10px 12px';
  panelEl.style.borderRadius = '8px';
  panelEl.style.maxWidth = '360px';
  panelEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
  panelEl.style.whiteSpace = 'pre-wrap';
  document.body.appendChild(panelEl);

  for (let slotIndex = 0; slotIndex < studentAuthService.SLOT_COUNT; slotIndex++) {
    unwatchFns.push(studentAuthService.watchSlotAuthState(slotIndex, () => refresh()));
  }

  refresh();
}

export function removeStudentAuthSlotDiagnostic() {
  unwatchFns.forEach((unwatch) => unwatch());
  unwatchFns = [];
  panelEl?.remove();
  panelEl = null;
}

async function refresh() {
  if (!panelEl) return;

  const activeProfile = studentDeviceService.getActiveProfile();
  const activeSlot = activeProfile ? studentDeviceService.getSlotForStudent(activeProfile.studentId) : null;

  let activeUidLine = 'No active profile';
  let activeUidError = null;
  if (activeProfile && activeSlot !== null) {
    try {
      const uid = await studentAuthService.ensureAnonymousSignIn(activeSlot);
      activeUidLine = `slot ${activeSlot} \u2192 ${uid}`;
    } catch (error) {
      activeUidError = error.message;
    }
  }

  const slotLines = [];
  for (let slotIndex = 0; slotIndex < studentAuthService.SLOT_COUNT; slotIndex++) {
    const auth = studentAuthService.getAuthForSlot(slotIndex);
    slotLines.push(`  slot ${slotIndex}: ${auth.currentUser ? auth.currentUser.uid : '(not signed in yet)'}`);
  }

  const uids = [];
  for (let slotIndex = 0; slotIndex < studentAuthService.SLOT_COUNT; slotIndex++) {
    const auth = studentAuthService.getAuthForSlot(slotIndex);
    if (auth.currentUser) uids.push(auth.currentUser.uid);
  }
  const allDistinct = uids.length > 0 ? new Set(uids).size === uids.length : null;

  panelEl.textContent =
    `=== Student Auth Slot Diagnostic (TEMPORARY) ===\n` +
    `Active profile: ${activeProfile ? `${activeProfile.studentName} (${activeProfile.studentId})` : 'none'}\n` +
    `Active slot: ${activeSlot ?? 'none'}\n` +
    `Active slot UID: ${activeUidError ? `ERROR: ${activeUidError}` : activeUidLine}\n` +
    `\nAll slots:\n${slotLines.join('\n')}\n` +
    `\nAll signed-in UIDs distinct? ${allDistinct === null ? 'n/a (none signed in yet)' : allDistinct ? 'YES' : 'NO \u2014 PROBLEM'}`;
}
