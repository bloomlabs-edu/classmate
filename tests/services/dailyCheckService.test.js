import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dailyCheckService from '../../js/services/dailyCheckService.js';

function freshClassroom() {
  return { id: 'c1', dailyChecks: [] };
}

const SUBJECT_ID = 'subj-eng';
const TYPE_ID = 'type-handwriting';
const STUDENT_ID = 'stu1';

// 2026-08-24 Mon, 25 Tue, 26 Wed, 27 Thu, 28 Fri, 29 Sat, 30 Sun, 31 Mon — verified via Date.getDay().

test('isWorkingWeekday: Monday-Friday true, Saturday/Sunday false', () => {
  assert.equal(dailyCheckService.isWorkingWeekday('2026-08-24'), true); // Mon
  assert.equal(dailyCheckService.isWorkingWeekday('2026-08-28'), true); // Fri
  assert.equal(dailyCheckService.isWorkingWeekday('2026-08-29'), false); // Sat
  assert.equal(dailyCheckService.isWorkingWeekday('2026-08-30'), false); // Sun
});

test('isExpectedCheckingDay: a working weekday in excludedDates is not expected', () => {
  const notebookType = { dailySettings: { excludedDates: ['2026-08-26'] } };
  assert.equal(dailyCheckService.isExpectedCheckingDay(notebookType, '2026-08-25'), true); // Tue, not excluded
  assert.equal(dailyCheckService.isExpectedCheckingDay(notebookType, '2026-08-26'), false); // Wed, excluded
  assert.equal(dailyCheckService.isExpectedCheckingDay(notebookType, '2026-08-29'), false); // Sat, weekend
});

test('isExpectedCheckingDay: safe to call before dailySettings exists at all', () => {
  assert.equal(dailyCheckService.isExpectedCheckingDay({}, '2026-08-24'), true);
});

test('setDailyCheck + getRecordForStudentOnDate: marking a day creates exactly one record, retrievable by exact date', () => {
  const classroom = freshClassroom();
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked' });
  const record = dailyCheckService.getRecordForStudentOnDate(classroom, SUBJECT_ID, TYPE_ID, STUDENT_ID, '2026-08-24');
  assert.equal(record.status, 'checked');
  assert.equal(dailyCheckService.getRecordForStudentOnDate(classroom, SUBJECT_ID, TYPE_ID, STUDENT_ID, '2026-08-25'), null);
});

test('setDailyCheck: calling twice for the same date updates in place rather than creating a second record', () => {
  const classroom = freshClassroom();
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked', score: 3 });
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked', score: 5 });
  assert.equal(classroom.dailyChecks.length, 1);
  assert.equal(classroom.dailyChecks[0].score, 5);
});

test('setDailyCheck: marking not_checked clears any previously-recorded score', () => {
  const classroom = freshClassroom();
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked', score: 5 });
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'not_checked' });
  const record = dailyCheckService.getRecordForStudentOnDate(classroom, SUBJECT_ID, TYPE_ID, STUDENT_ID, '2026-08-24');
  assert.equal(record.status, 'not_checked');
  assert.equal('score' in record, false);
});

test('STREAK: holiday/excluded day does not break the streak (Mon/Tue checked, Wed excluded, Thu/Fri checked -> streak 4)', () => {
  const classroom = freshClassroom();
  const notebookType = { dailySettings: { excludedDates: ['2026-08-26'] } }; // Wed excluded
  ['2026-08-24', '2026-08-25', '2026-08-27', '2026-08-28'].forEach((date) => {
    dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date, status: 'checked' });
  });
  const streak = dailyCheckService.getCurrentStreak(classroom, SUBJECT_ID, TYPE_ID, notebookType, STUDENT_ID, { asOfDate: '2026-08-28' });
  assert.equal(streak, 4);
});

test('STREAK: weekends do not break the streak even with no excludedDates entry for them (Fri checked, next Mon checked -> streak 2)', () => {
  const classroom = freshClassroom();
  const notebookType = { dailySettings: { excludedDates: [] } };
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-28', status: 'checked' }); // Fri
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-31', status: 'checked' }); // Mon
  const streak = dailyCheckService.getCurrentStreak(classroom, SUBJECT_ID, TYPE_ID, notebookType, STUDENT_ID, { asOfDate: '2026-08-31' });
  assert.equal(streak, 2);
});

test('STREAK: a missed expected checking day breaks the streak (Mon checked, Tue missed, Wed checked -> streak as of Wed is 1)', () => {
  const classroom = freshClassroom();
  const notebookType = { dailySettings: { excludedDates: [] } };
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked' }); // Mon
  // Tue 08-25 deliberately left unmarked (missed) — no setDailyCheck call.
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-26', status: 'checked' }); // Wed
  const streak = dailyCheckService.getCurrentStreak(classroom, SUBJECT_ID, TYPE_ID, notebookType, STUDENT_ID, { asOfDate: '2026-08-26' });
  assert.equal(streak, 1);
});

test('STREAK: an explicit not_checked status also breaks the streak, same as a missing record', () => {
  const classroom = freshClassroom();
  const notebookType = { dailySettings: { excludedDates: [] } };
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked' });
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-25', status: 'not_checked' });
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-26', status: 'checked' });
  const streak = dailyCheckService.getCurrentStreak(classroom, SUBJECT_ID, TYPE_ID, notebookType, STUDENT_ID, { asOfDate: '2026-08-26' });
  assert.equal(streak, 1);
});

test('STREAK: a low score never breaks the streak — streak counts completion only, independent of score', () => {
  const classroom = freshClassroom();
  const notebookType = { dailySettings: { excludedDates: [], scoringEnabled: true, scoreMax: 5 } };
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked', score: 5 });
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-25', status: 'checked', score: 1 }); // low score
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-26', status: 'checked', score: 5 });
  const streak = dailyCheckService.getCurrentStreak(classroom, SUBJECT_ID, TYPE_ID, notebookType, STUDENT_ID, { asOfDate: '2026-08-26' });
  assert.equal(streak, 3, 'a low score on day 2 must not break the streak');
});

test('STREAK: zero when the most recent expected checking day was missed', () => {
  const classroom = freshClassroom();
  const notebookType = { dailySettings: { excludedDates: [] } };
  dailyCheckService.setDailyCheck(classroom, { subjectId: SUBJECT_ID, notebookTypeId: TYPE_ID, studentId: STUDENT_ID, date: '2026-08-24', status: 'checked' });
  // 08-25 (Tue) never marked, asOfDate is 08-25 itself.
  const streak = dailyCheckService.getCurrentStreak(classroom, SUBJECT_ID, TYPE_ID, notebookType, STUDENT_ID, { asOfDate: '2026-08-25' });
  assert.equal(streak, 0);
});
