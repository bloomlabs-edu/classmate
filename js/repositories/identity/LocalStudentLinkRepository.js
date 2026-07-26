/**
 * repositories/identity/LocalStudentLinkRepository.js
 *
 * Generic implementation of StudentLinkRepository — genuinely any
 * real classroom's real student, not a fixed fictional roster. PINs
 * and invitation tokens are held in memory, keyed by the real
 * (classroomId, studentId) the caller provides; account-to-student
 * links are persisted via localStorage (so "future logins remember
 * the linked student" can be demonstrated across a real page reload).
 * No Firestore yet — that's still pending the AI Working Committee's
 * consent review (see StudentIdentityService.js's own compliance
 * note) — but nothing here depends on a fixed set of known students
 * the way the earlier demo-fixture version of this file did.
 *
 * This repository has no built-in knowledge of who any student is.
 * Every PIN and token record stores the studentName the caller passed
 * in at generation time (Student Access always has this, since it's
 * looking at the real roster) — that's what lets resolvePin() and
 * resolveInvitationToken() return a name later without this class
 * needing any independent roster of its own to look one up against.
 *
 * A production implementation would back this with the Firestore
 * collections documented in StudentLinkRepository.js's own doc
 * comment (identityLinks/{providerUserId}, invitationTokens/{token},
 * and a PIN field directly on the student object) — swapping that in
 * is the only change needed later; nothing above this repository
 * (StudentIdentityService.js, every UI screen) would need to change.
 */

import { StudentLinkRepository } from './StudentLinkRepository.js';

const LINKS_STORAGE_KEY = 'bloomLabsIdentityLinks';
const LAST_SELECTED_STORAGE_KEY = 'bloomLabsLastSelectedStudent';

// Keyed by studentId — real student ids (see utils/idGenerator.js)
// are already unique across the whole app, so no composite key is
// needed. Each entry is a full student ref plus its current PIN, so
// nothing here ever needs to ask "who is this student" anywhere else.
const pinsByStudentId = new Map();

// Keyed by the generated token string. Same reasoning as pins above —
// each entry carries its own full student ref.
const invitationTokens = new Map();

function readLinks() {
  try {
    const raw = window.localStorage.getItem(LINKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[LocalStudentLinkRepository] Failed to read links:', error);
    return {};
  }
}

function writeLinks(links) {
  try {
    window.localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(links));
  } catch (error) {
    console.error('[LocalStudentLinkRepository] Failed to write links:', error);
  }
}

export class LocalStudentLinkRepository extends StudentLinkRepository {
  async getLinkedStudents(providerUserId) {
    const links = readLinks();
    return links[providerUserId] || [];
  }

  /** The reverse direction of getLinkedStudents() — checks every provider user's link list for this one student, since the local store is keyed by provider user, not by student. A production repository (see StudentLinkRepository.js's own doc comment on the proposed identityLinks/{providerUserId} shape) would likely need a small denormalized index for this same reason — reverse-lookups against a mapping keyed the other way are exactly why. */
  async isStudentLinked(classroomId, studentId) {
    const links = readLinks();
    return Object.values(links).some((studentRefs) => studentRefs.some((ref) => ref.studentId === studentId));
  }

  async hasAnyInvitationForClassroom(classroomId) {
    return Array.from(invitationTokens.values()).some((entry) => entry.classroomId === classroomId);
  }

  async resolvePin(pin) {
    for (const entry of pinsByStudentId.values()) {
      if (entry.pin === pin) {
        const { classroomId, studentId, studentName } = entry;
        return { classroomId, studentId, studentName };
      }
    }
    return null;
  }

  async linkStudent(providerUserId, studentRef) {
    const links = readLinks();
    const existing = links[providerUserId] || [];
    if (!existing.some((ref) => ref.studentId === studentRef.studentId)) {
      links[providerUserId] = [...existing, studentRef];
      writeLinks(links);
    }
    // A PIN is a one-time linking token, not a reusable password — a
    // production implementation would clear it here (see
    // StudentLinkRepository.js's own doc comment on linkStudent()).
    // Left reusable in this local implementation so the same PIN can
    // be tested repeatedly while working on this feature.
  }

  async resolveInvitationToken(token) {
    const entry = invitationTokens.get(token);
    if (!entry) return null;
    if (entry.used) return null;
    if (Date.now() > entry.expiresAt) return null;
    const { classroomId, studentId, studentName } = entry;
    return { classroomId, studentId, studentName };
  }

  async redeemInvitationToken(providerUserId, token) {
    const resolved = await this.resolveInvitationToken(token);
    if (!resolved) return null;
    invitationTokens.get(token).used = true;
    await this.linkStudent(providerUserId, resolved);
    return resolved;
  }

  async setLastSelectedStudent(providerUserId, studentRef) {
    try {
      const raw = window.localStorage.getItem(LAST_SELECTED_STORAGE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[providerUserId] = studentRef;
      window.localStorage.setItem(LAST_SELECTED_STORAGE_KEY, JSON.stringify(map));
    } catch (error) {
      console.error('[LocalStudentLinkRepository] Failed to save last-selected student:', error);
    }
  }

  async getLastSelectedStudent(providerUserId) {
    try {
      const raw = window.localStorage.getItem(LAST_SELECTED_STORAGE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      return map[providerUserId] || null;
    } catch (error) {
      console.error('[LocalStudentLinkRepository] Failed to read last-selected student:', error);
      return null;
    }
  }

  // --- Teacher-side (Classroom Tracker) ---

  async generatePin(classroomId, studentId, studentName) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    pinsByStudentId.set(studentId, { classroomId, studentId, studentName, pin });
    return pin;
  }

  async generateInvitationToken(classroomId, studentId, studentName, expiryDays = 7) {
    const token = `${studentId}-${Date.now().toString(36)}`;
    invitationTokens.set(token, {
      classroomId,
      studentId,
      studentName,
      used: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
    });
    return token;
  }

  /** The current PIN for a student, or null if one hasn't been generated yet — lets UI screens show "no PIN yet" versus a real value without needing a separate existence check. */
  getCurrentPin(studentId) {
    return pinsByStudentId.get(studentId)?.pin || null;
  }
}
