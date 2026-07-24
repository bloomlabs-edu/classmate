/**
 * repositories/identity/DemoStudentLinkRepository.js
 *
 * Fixture-data implementation of StudentLinkRepository — a small,
 * made-up roster (not real students), with PINs and invitation tokens
 * held in memory, and the actual account-to-student *links* persisted
 * via localStorage (so "future logins remember the linked student"
 * can be genuinely demonstrated across a real page reload, the same
 * verification approach used for studentSessionService.js). No
 * Firestore, no real students, no real PINs distributed to anyone.
 *
 * A production implementation would back StudentLinkRepository with
 * the Firestore collections documented in that interface's own doc
 * comment (identityLinks/{providerUserId}, invitationTokens/{token},
 * and a PIN field on the existing student object) — this class exists
 * so every UI screen and the whole StudentIdentityService can be built
 * and reviewed today, with swapping in that production repository
 * being the only change needed later.
 */

import { StudentLinkRepository } from './StudentLinkRepository.js';

const LINKS_STORAGE_KEY = 'bloomLabsDemoIdentityLinks';
const LAST_SELECTED_STORAGE_KEY = 'bloomLabsDemoLastSelectedStudent';

const DEMO_CLASSROOM_ID = 'demo-classroom-bloom-force-19';

const DEMO_STUDENTS = [
  { classroomId: DEMO_CLASSROOM_ID, studentId: 'demo-student-hariharan', studentName: 'Hariharan', pin: '482913' },
  { classroomId: DEMO_CLASSROOM_ID, studentId: 'demo-student-blessy', studentName: 'Blessy', pin: '731064' },
];

// In-memory only — invitation tokens are demo fixtures, not something
// really distributed, so they don't need to survive a page reload the
// way the account-student *links* do.
const invitationTokens = new Map();

function readLinks() {
  try {
    const raw = window.localStorage.getItem(LINKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[DemoStudentLinkRepository] Failed to read links:', error);
    return {};
  }
}

function writeLinks(links) {
  try {
    window.localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(links));
  } catch (error) {
    console.error('[DemoStudentLinkRepository] Failed to write links:', error);
  }
}

function findStudent(studentId) {
  return DEMO_STUDENTS.find((s) => s.studentId === studentId) || null;
}

export class DemoStudentLinkRepository extends StudentLinkRepository {
  async getLinkedStudents(providerUserId) {
    const links = readLinks();
    const studentIds = links[providerUserId] || [];
    return studentIds
      .map((studentId) => findStudent(studentId))
      .filter(Boolean)
      .map(({ classroomId, studentId, studentName }) => ({ classroomId, studentId, studentName }));
  }

  /** The reverse direction of getLinkedStudents() — checks every provider user's link list for this one student, since the demo store is keyed by provider user, not by student. A production repository (see StudentLinkRepository.js's own doc comment on the proposed identityLinks/{providerUserId} shape) would likely need a small denormalized index for this same reason — reverse-lookups against a mapping keyed the other way are exactly why. */
  async isStudentLinked(classroomId, studentId) {
    const links = readLinks();
    return Object.values(links).some((studentIds) => studentIds.includes(studentId));
  }

  async isStudentLinked(classroomId, studentId) {
    const links = readLinks();
    return Object.values(links).some((studentIds) => studentIds.includes(studentId));
  }

  async resolvePin(pin) {
    const student = DEMO_STUDENTS.find((s) => s.pin === pin);
    if (!student) return null;
    const { classroomId, studentId, studentName } = student;
    return { classroomId, studentId, studentName };
  }

  async linkStudent(providerUserId, studentRef) {
    const links = readLinks();
    const existing = links[providerUserId] || [];
    if (!existing.includes(studentRef.studentId)) {
      links[providerUserId] = [...existing, studentRef.studentId];
      writeLinks(links);
    }
    // A demo PIN is reusable on purpose (so this fixture can be tested
    // repeatedly) — a production implementation would clear the PIN
    // here, since it's a one-time linking token, not a password (see
    // StudentLinkRepository.js's own doc comment on linkStudent()).
  }

  async resolveInvitationToken(token) {
    const entry = invitationTokens.get(token);
    if (!entry) return null;
    if (entry.used) return null;
    if (Date.now() > entry.expiresAt) return null;
    const student = findStudent(entry.studentId);
    if (!student) return null;
    const { classroomId, studentId, studentName } = student;
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
      map[providerUserId] = studentRef.studentId;
      window.localStorage.setItem(LAST_SELECTED_STORAGE_KEY, JSON.stringify(map));
    } catch (error) {
      console.error('[DemoStudentLinkRepository] Failed to save last-selected student:', error);
    }
  }

  async getLastSelectedStudent(providerUserId) {
    try {
      const raw = window.localStorage.getItem(LAST_SELECTED_STORAGE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const studentId = map[providerUserId];
      if (!studentId) return null;
      const student = findStudent(studentId);
      if (!student) return null;
      const { classroomId, studentId: id, studentName } = student;
      return { classroomId, studentId: id, studentName };
    } catch (error) {
      console.error('[DemoStudentLinkRepository] Failed to read last-selected student:', error);
      return null;
    }
  }

  // --- Teacher-side (Classroom Tracker) ---

  async generatePin(classroomId, studentId) {
    const student = findStudent(studentId);
    if (!student) throw new Error(`Unknown demo student: ${studentId}`);
    student.pin = String(Math.floor(100000 + Math.random() * 900000));
    return student.pin;
  }

  async generateInvitationToken(classroomId, studentId, expiryDays = 7) {
    const student = findStudent(studentId);
    if (!student) throw new Error(`Unknown demo student: ${studentId}`);
    const token = `demo-${studentId}-${Date.now().toString(36)}`;
    invitationTokens.set(token, {
      classroomId,
      studentId,
      used: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
    });
    return token;
  }

  /** Demo-only helper, not part of the interface — lets teacher-side UI list the fixture roster and current PINs without a real classroom lookup. */
  listDemoRoster() {
    return DEMO_STUDENTS.map(({ classroomId, studentId, studentName, pin }) => ({ classroomId, studentId, studentName, pin }));
  }
}
