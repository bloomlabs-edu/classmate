/**
 * services/membershipLinkService.js
 *
 * PHASE 1 — Membership Identity Foundation.
 *
 * Establishes (once per device) the link a future Learning Circle
 * StudentEntry security rule will need: this device's own per-slot
 * Firebase Auth uid corresponds to a specific studentId's active
 * membership in a specific Learning Programme.
 *
 * NOT YET CALLED FROM ANYWHERE — by this Phase's own explicit scope,
 * Student Portal integration is a separate, later authorization.
 * ensureMembershipLinkForCurrentStudent() below is the exact function
 * a future Student Portal screen will call the first time it actually
 * needs Learning Circle access — see this function's own header
 * comment for why it deliberately isn't called any earlier than that.
 *
 * TRANSPARENT BY DESIGN — no new screen, no button, no separate
 * onboarding step. The caller (a future Learning Circle view) simply
 * calls this before its own first read; from the student's own
 * perspective nothing appears to happen at all beyond their content
 * loading normally, exactly matching this app's own established,
 * zero-friction Student Portal onboarding philosophy (see
 * ui/student-portal/onboarding/StudentDeviceFlow.js's own header
 * comment).
 */

import * as studentDeviceService from './studentDeviceService.js';
import * as studentAuthService from './studentAuthService.js';
import * as firestoreMembershipLinkRepository from '../repositories/firestoreMembershipLinkRepository.js';
import { createMembershipLink } from '../models/MembershipLink.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/**
 * Ensures the current device's own membership link exists for one
 * specific Learning Programme — creating it if (and only if) it
 * doesn't exist yet. Idempotent: safe to call every time a student
 * opens their own Learning Circle, not just the first time.
 *
 * Deliberately scoped to ONE programmeId per call, not "every
 * programme this student belongs to" — a link is only ever created
 * for a programme this device's own Learning Circle screen is
 * actually about to read, matching this Phase's own explicit "only
 * create links when the student actually needs Learning Circle
 * access... not merely by browsing unrelated ClassMate features"
 * instruction. Nothing in Student Mode calls this yet (see this
 * file's own header comment) — a future Learning Circle screen is
 * expected to call it, once, before its own first StudentEntry read.
 *
 * Returns the existing or newly-created link's own data, or null if
 * this device has no active student profile at all (nothing to link
 * yet — not an error, just nothing to do).
 */
export async function ensureMembershipLinkForCurrentStudent(classroomId, programmeId) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);
  const db = studentAuthService.getFirestoreForSlot(slotIndex);

  const existing = await firestoreMembershipLinkRepository.getMembershipLink(db, { classroomId, programmeId, uid });
  if (existing) return existing;

  const link = createMembershipLink({ studentId: activeProfile.studentId, joinedAt: getCurrentIsoDate() });
  await firestoreMembershipLinkRepository.createMembershipLink(db, { classroomId, programmeId, uid, link });
  return link;
}
