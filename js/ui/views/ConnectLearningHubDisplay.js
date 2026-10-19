/**
 * ui/views/ConnectLearningHubDisplay.js
 *
 * Pure display logic extracted out of ui/views/ConnectLearningHubView.js
 * specifically so it's unit-testable under plain `node --test` — that
 * view's own file imports
 * repositories/firestoreLearnerConnectionRepository.js, which (like
 * every Firestore-touching module in this app) imports Firestore via an
 * `https://` specifier Node's own ESM loader can't resolve at all. See
 * config/classroomRouteNames.js's own header comment for the exact same
 * reasoning applied to main.js/ui/router.js, and
 * ui/views/MyWorkTaskDisplay.js for this same "extract the pure half"
 * convention already established for another view.
 *
 * models/LearnerConnection.js has zero Firestore/network imports of its
 * own (see that file's own header comment), so importing
 * RELATIONSHIP_STATUS from it here is safe under plain `node --test`.
 */

import { RELATIONSHIP_STATUS, buildRelationshipId } from '../../models/LearnerConnection.js';

export const STATUS_LABELS = Object.freeze({
  [RELATIONSHIP_STATUS.PENDING]: 'Pending',
  [RELATIONSHIP_STATUS.ACTIVE]: 'Verified',
  [RELATIONSHIP_STATUS.REJECTED]: 'Rejected',
  [RELATIONSHIP_STATUS.REVOKED]: 'Revoked',
});

export const STATUS_MODIFIERS = Object.freeze({
  [RELATIONSHIP_STATUS.PENDING]: 'pending',
  [RELATIONSHIP_STATUS.ACTIVE]: 'active',
  [RELATIONSHIP_STATUS.REJECTED]: 'rejected',
  [RELATIONSHIP_STATUS.REVOKED]: 'rejected',
});

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function statusModifier(status) {
  return STATUS_MODIFIERS[status] || 'pending';
}

/**
 * A de-emphasized, never-the-full-value rendering of an opaque
 * learnerProfileId — the ONLY identity signal a pending/decided row
 * ever shows (ClassMate has no name/email for a Learning Hub learner;
 * see the architecture doc's §8).
 */
export function truncateLearnerProfileId(learnerProfileId) {
  if (!learnerProfileId) return 'unknown learner';
  return learnerProfileId.length > 12 ? `${learnerProfileId.slice(0, 10)}…` : learnerProfileId;
}

/**
 * Splits a classroom's relationships into "Pending" (shown first) and
 * "Recently decided" (ACTIVE + REJECTED + REVOKED, shown
 * second/collapsed) — per the architecture review's own explicit
 * requirement, every relationship document stays its own distinct row
 * here; nothing is ever merged by invitationCode or any other shared
 * field. Order within each group is preserved as given (callers that
 * want newest-first should sort `relationships` first).
 */
export function groupRelationshipsByQueueSection(relationships) {
  const pending = [];
  const decided = [];
  for (const relationship of relationships) {
    if (relationship.status === RELATIONSHIP_STATUS.PENDING) pending.push(relationship);
    else decided.push(relationship);
  }
  return { pending, decided };
}

/**
 * The roster picker's own option list — built from the SAME
 * `{ student, team }` pairs ui/components/StudentMultiSelect.js already
 * assembles from `classroom.teams.flatMap(...)`, so by construction
 * this can only ever offer students that actually belong to the
 * classroom the caller passed in (never another classroom's roster,
 * never a typed/free-form id — see ui/components/SearchableSelect.js's
 * own `allowCustom: false` contract, enforced by the caller, not by
 * this function).
 */
export function buildRosterOptions(allRosterStudents) {
  return allRosterStudents.map(({ student, team }) => ({
    value: student.id,
    label: team ? `${student.name} — ${team.name}` : student.name,
  }));
}

/**
 * The deterministic notification id for "this classroom's CURRENT wave
 * of pending requests" — fixes a real dedup bug found in QA: a FIXED id
 * (`connection_requests_${classroomId}`) permanently suppresses every
 * future notification for a classroom after the first one ever fires,
 * via `publishNotificationIfAbsent`'s own "already exists -> no-op"
 * semantics (repositories/firestoreNotificationRepository.js's own
 * createNotificationIfAbsent()). That's correct for aggregating
 * multiple simultaneously-pending requests into ONE notification, but
 * wrong once that whole wave resolves (every member of it reaches
 * ACTIVE/REJECTED) and a genuinely NEW pending request arrives later —
 * the fixed id would silently never notify again.
 *
 * Fix, kept deliberately minimal (no new Firestore field, no new
 * notification framework, still just one `publishNotificationIfAbsent`
 * call): key the id off the OLDEST currently-pending relationship's own
 * id. While any member of a wave is still pending, the oldest member
 * doesn't change, so every new arrival within that same wave keeps
 * reusing the same notification id (still exactly one notification per
 * wave, never one per learner — unchanged from before). Once the
 * current oldest pending relationship itself resolves, the "oldest
 * pending" pointer necessarily moves to either a different
 * still-pending member of the same wave, or — once the whole wave has
 * cleared — to a brand-new relationship from a later wave, which
 * necessarily produces a DIFFERENT id and so is free to notify again.
 *
 * Returns `null` when there is nothing pending at all (nothing to
 * notify about). Never includes anything beyond relationship ids
 * already readable by this classroom's own teacher via
 * `listRelationshipsForClassroom()` — no new exposure.
 */
export function buildPendingWaveNotificationId(classroomId, relationships) {
  const pending = relationships.filter((relationship) => relationship.status === RELATIONSHIP_STATUS.PENDING);
  if (pending.length === 0) return null;

  const oldestPending = pending.reduce((oldest, relationship) => {
    if (!oldest) return relationship;
    return new Date(relationship.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? relationship : oldest;
  }, null);

  return `connection_requests_${buildRelationshipId(oldestPending.learnerProfileId, classroomId)}`;
}
