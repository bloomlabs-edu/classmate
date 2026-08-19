/**
 * models/ProgrammeMembership.js
 *
 * One student's own span of membership in one Learning Programme —
 * independent from that student's classroom/Team membership entirely
 * (see models/Team.js). A student can belong to a classroom Team AND
 * any number of Learning Programmes at once; leaving a programme must
 * never touch their Team membership, and vice versa.
 *
 * `studentId` is a reference into the classroom's own real roster
 * (`classroom.teams[].students[]`), never a copy of the student's own
 * profile data — the same "reference, not copy" convention already
 * used throughout this app (see models/Assessment.js's own
 * StudentResult.studentId, models/Goal.js's own studentId).
 *
 * `joinedAt`/`leftAt`/`status` exist specifically so a student's
 * membership has real, preserved history — deliberately NOT a bare
 * `studentIds: []` array on the programme, which could only ever
 * represent "who is a member right now" and would silently lose the
 * fact that a student was ever a member at all the moment they left.
 * `status` is 'active' | 'left'; leaving sets `leftAt` and flips
 * `status` to 'left' on this exact record — it is never deleted, and
 * a re-join later creates a brand NEW ProgrammeMembership record (a
 * new `joinedAt`) rather than reviving or overwriting the old one, so
 * a student's full membership history (every distinct stint) remains
 * intact and readable.
 *
 * This is intentionally a small, standalone factory — not folded
 * into models/LearningProgramme.js's own file — so membership
 * creation/shape stays a single, obvious import if this data is ever
 * promoted from `LearningProgramme.memberships[]` to its own
 * subcollection later (see that model's own header comment). Nothing
 * about this factory's own shape assumes where the resulting object
 * is stored.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createProgrammeMembership({ id, studentId, joinedAt, leftAt = null, status = 'active' } = {}) {
  return {
    id: id || generateId(),
    studentId,
    joinedAt: joinedAt || getCurrentIsoDate(),
    leftAt,
    status,
  };
}
