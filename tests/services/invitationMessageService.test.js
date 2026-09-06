import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoTeacherInvitationMessage, buildVisitorInvitationMessage } from '../../js/services/invitationMessageService.js';

test('buildCoTeacherInvitationMessage: includes classroom name, code, and join instructions', () => {
  const message = buildCoTeacherInvitationMessage({ classroomName: 'Grade 8A', code: 'AB12CD' });
  assert.ok(message.includes('Grade 8A'));
  assert.ok(message.includes('AB12CD'));
  assert.ok(/join a classroom/i.test(message));
  assert.ok(/full access/i.test(message));
});

test('buildVisitorInvitationMessage: includes classroom name, visitor code, and visitor link', () => {
  const message = buildVisitorInvitationMessage({ classroomName: 'Grade 8A', code: 'XY34ZW', link: 'https://classmate.app/#/visitor/XY34ZW' });
  assert.ok(message.includes('Grade 8A'));
  assert.ok(message.includes('XY34ZW'));
  assert.ok(message.includes('https://classmate.app/#/visitor/XY34ZW'));
  assert.ok(/visitor/i.test(message));
});

/**
 * Per explicit product direction: an invitation, not a permissions
 * notice — the underlying access is still exactly as narrow as
 * services/visitorAccessService.js implements (see that file's own
 * tests), this only asserts the MESSAGE COPY never frames it in terms
 * of limitations.
 */
test('buildVisitorInvitationMessage: never mentions limitations, read-only status, membership, or what the visitor cannot see — an invitation, not a permissions notice', () => {
  const message = buildVisitorInvitationMessage({ classroomName: 'Grade 8A', code: 'XY34ZW', link: 'https://classmate.app/#/visitor/XY34ZW' });
  assert.ok(!/read-only/i.test(message));
  assert.ok(!/not a real member/i.test(message));
  assert.ok(!/no sign-in/i.test(message));
  assert.ok(!/student names?/i.test(message));
  assert.ok(!/scores?/i.test(message));
  assert.ok(!/notebooks?/i.test(message));
  assert.ok(!/full access/i.test(message));
  assert.ok(!/permission/i.test(message));
});
