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
 * Read-only, no-sign-in invitation — the invitee never becomes a
 * classroom member (see services/visitorAccessService.js's own header
 * comment on why); redeeming `code` only ever opens a sanitized,
 * read-only demo of this classroom's structure, never real student
 * data.
 */
export function buildVisitorInvitationMessage({ classroomName, code, link }) {
  return `👀 You've been invited to see how "${classroomName}" works on ClassMate!\n\nYou're joining as a visitor — a read-only look at how the classroom is set up, not a real member. No sign-in needed, and you won't see actual student names, scores, or notebooks.\n\nTo take a look:\nOpen this link and enter the code below.\n\nVisitor Code:\n${code}\n\nVisitor Link:\n${link}`;
}
