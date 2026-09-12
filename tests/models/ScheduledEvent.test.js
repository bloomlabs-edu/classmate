import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledEvent, SCHEDULED_EVENT_TYPES } from '../../js/models/ScheduledEvent.js';

test('createScheduledEvent: subjectId/customSubjectName default to null (never undefined) when omitted', () => {
  const event = createScheduledEvent({ classroomId: 'c1', date: '2026-09-14', startTime: '09:00', endTime: '09:45' });
  assert.equal(event.subjectId, null);
  assert.notEqual(event.subjectId, undefined);
  assert.equal(event.customSubjectName, null);
  assert.notEqual(event.customSubjectName, undefined);
  assert.equal(event.eventType, SCHEDULED_EVENT_TYPES.EXAM);
});

test('createScheduledEvent: customSubjectName round-trips when supplied alongside a derived subjectId', () => {
  const event = createScheduledEvent({
    classroomId: 'c1',
    date: '2026-09-14',
    startTime: '09:00',
    endTime: '10:30',
    subjectId: 'custom_french',
    customSubjectName: 'French',
  });
  assert.equal(event.subjectId, 'custom_french');
  assert.equal(event.customSubjectName, 'French');
});

test('createScheduledEvent: a canonical subjectId with no customSubjectName leaves customSubjectName null', () => {
  const event = createScheduledEvent({
    classroomId: 'c1',
    date: '2026-09-14',
    startTime: '09:00',
    endTime: '10:30',
    subjectId: 'science',
  });
  assert.equal(event.subjectId, 'science');
  assert.equal(event.customSubjectName, null);
});
