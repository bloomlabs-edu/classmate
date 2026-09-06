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

test('buildVisitorInvitationMessage: includes classroom name, code, link, and explains read-only visitor status', () => {
  const message = buildVisitorInvitationMessage({ classroomName: 'Grade 8A', code: 'XY34ZW', link: 'https://classmate.app/#/visitor/XY34ZW' });
  assert.ok(message.includes('Grade 8A'));
  assert.ok(message.includes('XY34ZW'));
  assert.ok(message.includes('https://classmate.app/#/visitor/XY34ZW'));
  assert.ok(/visitor/i.test(message));
  assert.ok(/read-only/i.test(message));
  assert.ok(!/full access/i.test(message));
});
