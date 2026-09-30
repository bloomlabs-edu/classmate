/**
 * services/memberService.js
 *
 * Operates on a Classroom's real, Google-authenticated membership —
 * `members` (a map of uid -> {role, displayName, joinedAt}) and
 * `memberUids` (a parallel array of the same keys; see
 * models/Classroom.js for why both exist).
 *
 * This replaces the earlier name-only Member system from before real
 * auth existed. Invitations (an owner invites a teacher by email, the
 * teacher accepts) are a later phase — addMember() here is already
 * exactly what accepting an invitation will call, so that phase is
 * additive, not a rework of this file.
 */

import { MEMBER_ROLES } from '../config/memberRoles.js';

export function addMember(classroom, uid, role, displayName) {
  if (!classroom.members) classroom.members = {};
  if (!classroom.memberUids) classroom.memberUids = [];

  classroom.members[uid] = {
    role,
    displayName: displayName || 'Teacher',
    joinedAt: new Date().toISOString(),
  };

  if (!classroom.memberUids.includes(uid)) {
    classroom.memberUids.push(uid);
  }
}

/** Refuses to remove the owner — use a future transfer-ownership flow instead. */
export function removeMember(classroom, uid) {
  if (isOwner(classroom, uid)) return false;

  const existed = Boolean(classroom.members?.[uid]);
  if (classroom.members) delete classroom.members[uid];
  if (classroom.memberUids) {
    classroom.memberUids = classroom.memberUids.filter((memberUid) => memberUid !== uid);
  }
  return existed;
}

export function getRole(classroom, uid) {
  return classroom.members?.[uid]?.role || null;
}

export function isOwner(classroom, uid) {
  return getRole(classroom, uid) === MEMBER_ROLES.OWNER;
}

/**
 * The single, shared definition of "is this uid a real Program Manager
 * anywhere" — a PM's authority comes entirely from an actual
 * `classroom.members[uid] = { role: 'program_manager' }` entry on at
 * least one classroom they were added to (see config/memberRoles.js's
 * own PROGRAM_MANAGER comment), never inferred from being that
 * classroom's owner/creator, and never a global account attribute.
 * Originally written inline in ui/views/PersonalHubView.js (to decide
 * whether to show the Weekly Plans/Observations/Chapter Plans nav
 * rows); extracted here so main.js's own PM route guards check the
 * exact same condition rather than a second, potentially-drifting copy
 * of it.
 */
export function isProgramManagerAnywhere(classrooms, uid) {
  return (classrooms || []).some((classroom) => getRole(classroom, uid) === MEMBER_ROLES.PROGRAM_MANAGER);
}

/**
 * Every classroom id where this uid actually holds `program_manager` —
 * the real credentials isProgramManagerAnywhere() above only reports
 * the existence of. Used by ClassMate Knowledge Model authoring (see
 * ui/views/KnowledgeAuthoringView.js) to resolve a real
 * `authorizingClassroomId` for a knowledge record write: firestore.rules'
 * own isKnowledgeAuthor() needs ONE concrete classroom to check
 * membership/role against (see that rule's own header comment on why),
 * so a caller needs the actual id(s), not just a yes/no. Almost always
 * a single-item array in practice (a PM is typically added to one
 * classroom at a time via the existing manual grant process — see
 * config/memberRoles.js's own PROGRAM_MANAGER comment) but never
 * assumed to be.
 */
export function getProgramManagerClassroomIds(classrooms, uid) {
  return (classrooms || []).filter((classroom) => getRole(classroom, uid) === MEMBER_ROLES.PROGRAM_MANAGER).map((classroom) => classroom.id);
}

export function listMembers(classroom) {
  return Object.entries(classroom.members || {}).map(([uid, info]) => ({ uid, ...info }));
}

export function getOwner(classroom) {
  return listMembers(classroom).find((member) => member.role === MEMBER_ROLES.OWNER) || null;
}

export function listTeachers(classroom) {
  return listMembers(classroom).filter((member) => member.role !== MEMBER_ROLES.OWNER);
}
