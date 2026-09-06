/**
 * services/invitationMessageService.js
 *
 * The ready-to-share text for every classroom invitation this app
 * offers — one function per role, so "what does this message say" is
 * never composed ad hoc at a click-handler call site. Pure string
 * building, no Firestore/DOM — the caller (ui/views/StudentAccessView.js)
 * is responsible for actually copying/sharing whatever these return.
 *
 * Deliberately mirrors createInviteStudentsCard()'s own existing
 * student invitation text shape (a greeting line, then labeled
 * code/link lines) rather than inventing a new tone or format — a
 * teacher reading three different invitation messages should recognize
 * them as the same family, not three unrelated blurbs.
 */

/** Full-access invitation — the invitee becomes a real co-teacher (see services/memberService.js's own addMember(), config/memberRoles.js's MEMBER_ROLES.TEACHER) once they redeem `code`. */
export function buildCoTeacherInvitationMessage({ classroomName, code }) {
  return `👩‍🏫 You've been invited to co-teach "${classroomName}" on ClassMate!\n\nThis gives you full access to students, scores, and settings — the same access as any other teacher on this classroom.\n\nTo join:\n1. Sign in to ClassMate with your own Google account.\n2. From your Home screen, tap "Join a Classroom."\n3. Enter this code:\n${code}`;
}

/**
 * A warm, inviting message — never a list of what the invitee can't do
 * (per explicit product direction: this should read as an invitation
 * to a Classroom Tour, not a permissions notice). The actual behavior
 * behind it is unchanged: no sign-in, and redeeming `code` only ever
 * opens a sanitized tour of this classroom's structure (see
 * services/visitorAccessService.js's own header comment) — this is a
 * copy-only concern, not an authorization one.
 */
export function buildVisitorInvitationMessage({ classroomName, code, link }) {
  return `👀 Come take a look at "${classroomName}" on ClassMate!\n\nI've shared my classroom with you so you can explore how ClassMate works from a teacher's perspective.\n\nStart exploring:\n${link}\n\nVisitor code: ${code}`;
}
