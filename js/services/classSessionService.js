/**
 * services/classSessionService.js
 *
 * A Class Session is the thing a teacher is actually conducting during
 * Class Mode — not a series of independent database writes. Every
 * action during a session (star, behaviour point, notebook update,
 * recognition) already mutates the in-memory classroom object exactly
 * as it did before this existed (see classModeService.js — unchanged);
 * what changes is that nothing calls workspaceService.save() per
 * action anymore. This service is what turns "a pile of in-memory
 * mutations" into something a teacher can review, save as one
 * intentional write, or throw away entirely.
 *
 * In-memory only, per classroom, exactly like classModeService's own
 * undo stack (which this sits alongside, not on top of) — never
 * written to Firestore itself. A session's only two possible endings
 * are: commitSession() (the one and only permanent write) or
 * discardSession() (nothing written, in-memory draft state thrown
 * away by re-fetching the classroom from Firestore).
 */

import * as workspaceService from './workspaceService.js';
import * as classModeService from './classModeService.js';

const sessionByClassroomId = new Map();

function getOrCreateSession(classroomId) {
  if (!sessionByClassroomId.has(classroomId)) {
    sessionByClassroomId.set(classroomId, {
      startedAt: new Date().toISOString(),
      actions: [], // { type: 'star' | 'behaviour' | 'badge' | 'bucket' | 'notebook' }
    });
  }
  return sessionByClassroomId.get(classroomId);
}

export function isSessionActive(classroom) {
  return sessionByClassroomId.has(classroom.id);
}

/**
 * Used by main.js's beforeunload handler — a page refresh/close isn't
 * scoped to one classroom the way the Back button is, so this checks
 * across every session this browser tab is tracking, not just one.
 */
export function hasAnyUnsavedSession() {
  for (const session of sessionByClassroomId.values()) {
    if (session.actions.length > 0) return true;
  }
  return false;
}

export function startSession(classroom) {
  sessionByClassroomId.set(classroom.id, { startedAt: new Date().toISOString(), actions: [] });
}

/**
 * Called alongside every classModeService action (award, deduct,
 * badge, bucket) and every notebook status change — records that a
 * draft change happened, for the Session Review count and Top
 * Contributors. Does NOT duplicate what classModeService's undo stack
 * already tracks; this is a separate, simpler log purely for "how many
 * of each kind of thing happened this session, and to whom," not for
 * reversing anything. `student` is optional — notebook updates aren't
 * tied to one specific student the way a star or badge is, so they're
 * recorded without one.
 */
export function recordAction(classroom, type, student = null) {
  const session = getOrCreateSession(classroom.id);
  session.actions.push({
    type,
    at: new Date().toISOString(),
    studentId: student?.id || null,
    studentName: student?.name || null,
  });
}

/** Powers the Session Review screen's counts. */
export function getSessionSummary(classroom) {
  const session = sessionByClassroomId.get(classroom.id);
  const actions = session?.actions || [];
  return {
    starsAwarded: actions.filter((a) => a.type === 'star').length,
    behaviourNotes: actions.filter((a) => a.type === 'behaviour').length,
    notebookUpdates: actions.filter((a) => a.type === 'notebook').length,
    recognitions: actions.filter((a) => a.type === 'badge').length,
    totalActions: actions.length,
  };
}

/**
 * Ranks students by stars awarded this session — matching the
 * "+N Stars" framing in the spec exactly, not a blended "positive
 * actions" score mixing stars and badges together, which would be
 * harder to explain at a glance. Ties share the same medal (standard
 * competition ranking): two students tied for 1st both get 🥇 and the
 * next distinct count gets 🥉, not 🥈 — skipping silver entirely
 * rather than awarding it to nobody or awarding two golds and a silver
 * to a lower count than either of them.
 */
export function getTopContributors(classroom, limit = 3) {
  const session = sessionByClassroomId.get(classroom.id);
  const actions = session?.actions || [];

  const starsByStudent = new Map(); // studentId -> { name, count }
  actions
    .filter((a) => a.type === 'star' && a.studentId)
    .forEach((a) => {
      const existing = starsByStudent.get(a.studentId) || { name: a.studentName, count: 0 };
      existing.count += 1;
      starsByStudent.set(a.studentId, existing);
    });

  const ranked = Array.from(starsByStudent.values())
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  const distinctCounts = [...new Set(ranked.map((entry) => entry.count))].slice(0, limit);
  return ranked.filter((entry) => distinctCounts.includes(entry.count));
}

/**
 * The single permanent write for the whole session — this is the only
 * place classroom-mode-originated changes reach Firestore now. Every
 * per-action save() call that used to happen on every tap has been
 * removed from classModeService's callers; this replaces all of them
 * with exactly one write, at the moment the teacher explicitly chooses
 * to save.
 */
export function commitSession(classroom) {
  // TEMPORARY DIAGNOSTIC — comparing this exact classroom reference
  // (immediately before the real write) against what
  // awardStar()/awardBadgeQuick() logged immediately after
  // publishEvent() (see services/classModeService.js). If these
  // differ, the classroom reference changed identity somewhere in
  // between; if they match, the investigation moves to Firestore
  // persistence itself, not object identity.
  console.log('[EventTraceDiagnostic] commitSession() \u2014 immediately BEFORE workspaceService.save():');
  console.log('[EventTraceDiagnostic]   classroom.studentEvents exists?', 'studentEvents' in classroom);
  console.log('[EventTraceDiagnostic]   classroom.studentEvents.length:', classroom.studentEvents?.length);
  console.log('[EventTraceDiagnostic]   classroom.studentEvents:', JSON.stringify(classroom.studentEvents));

  workspaceService.save(classroom);
  classModeService.clearUndoStack(classroom);
  sessionByClassroomId.delete(classroom.id);

  // TEMPORARY DIAGNOSTIC — answers one question conclusively: does the
  // persisted document actually contain studentEvents after a real
  // commit, verified via a genuine fresh read through this app's own
  // repository abstraction (not the in-memory classroom object, not a
  // manual Firebase import). See this project's own Student Event Feed
  // investigation. flushPendingSaves() ensures the write has actually
  // settled before reading back — without it, this fresh read could
  // race ahead of the write it's meant to verify.
  workspaceService.flushPendingSaves().then(async () => {
    const persisted = await workspaceService.getClassroomOnce(classroom.id);
    const hasField = persisted ? 'studentEvents' in persisted : false;
    console.log('[EventFeedDiagnostic] Fresh read after commitSession():');
    console.log('[EventFeedDiagnostic]   studentEvents field exists?', hasField);
    console.log('[EventFeedDiagnostic]   event count:', persisted?.studentEvents?.length ?? 0);
    console.log('[EventFeedDiagnostic]   first event:', persisted?.studentEvents?.[0] ?? null);
  });
}

/**
 * Nothing was ever written, so there's nothing to undo on the server —
 * only the in-memory draft mutations need to be thrown away. Since
 * Firestore was never touched, the classroom document there is still
 * exactly what it was before the session started; re-fetching it and
 * replacing the in-memory copy discards every draft change at once,
 * without needing to track and reverse each one individually.
 */
export async function discardSession(classroom) {
  await workspaceService.reloadClassroomFromServer(classroom.id);
  classModeService.clearUndoStack(classroom);
  sessionByClassroomId.delete(classroom.id);
}
