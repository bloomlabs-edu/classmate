/**
 * tests/ui/holidayReschedule.emulator.test.js
 *
 * End-to-end acceptance coverage for holiday rescheduling, driven
 * through the REAL Timetable UI (ui/views/TimetableView.js's own
 * renderTimetableView() → "School calendar" → Mark a date → Save),
 * real Chromium via Playwright, real Firestore + Auth emulators — same
 * pattern/rationale as the term-based-textbooks feature's own
 * termTextbooksTimetableAcceptance.emulator.test.js (see that file, in
 * the sibling classmate-term-investigation worktree, for the fuller
 * "why real auth, why the real project id" writeup; not repeated here).
 *
 * Requires BOTH the Firestore AND Auth emulators running (`firebase
 * emulators:start --only firestore,auth --project classmate-302c2`).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'classmate-302c2';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const CLASSROOM_ID = 'classroom-holiday-reschedule-accept';
const TEACHER_UID = 'teacher-hr-1';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONTENT_TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(REPO_ROOT, urlPath === '/' ? '/index.html' : urlPath);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let server;
let port;
let browser;
let page;
let adminApp;
let adminDb;
let pendingDialogAction = 'dismiss';

test.before(async () => {
  adminApp = admin.initializeApp({ projectId: PROJECT_ID }, 'holiday-reschedule-acceptance-admin');
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  adminDb = getFirestore(adminApp);

  await adminDb.collection('classrooms').doc(CLASSROOM_ID).set({
    id: CLASSROOM_ID,
    schoolName: 'Test School',
    gradeSection: 'Grade 8',
    academicYear: '2026-27',
    ownerUid: TEACHER_UID,
    memberUids: [TEACHER_UID],
    members: { [TEACHER_UID]: { role: 'teacher' } },
  });

  // Idempotency across re-runs — this classroom id is fixed.
  const staleLessons = await adminDb.collection('classrooms').doc(CLASSROOM_ID).collection('lessons').get();
  await Promise.all(staleLessons.docs.map((d) => d.ref.delete()));
  const staleEvents = await adminDb.collection('classrooms').doc(CLASSROOM_ID).collection('scheduledEvents').get();
  await Promise.all(staleEvents.docs.map((d) => d.ref.delete()));

  const customToken = await getAuth(adminApp).createCustomToken(TEACHER_UID);

  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('dialog', async (dialog) => {
    console.log('[browser dialog]', dialog.message());
    if (pendingDialogAction === 'accept') await dialog.accept();
    else await dialog.dismiss();
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console error]', msg.text());
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`);

  const signInResult = await page.evaluate(
    async ({ authEmulatorHost, customToken }) => {
      const { getAuth, connectAuthEmulator, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
      const { getFirebaseApp } = await import('/js/services/firebaseApp.js');
      const auth = getAuth(getFirebaseApp());
      connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
      const credential = await signInWithCustomToken(auth, customToken);
      return { uid: credential.user.uid };
    },
    { authEmulatorHost: AUTH_EMULATOR_HOST, customToken }
  );
  assert.equal(signInResult.uid, TEACHER_UID);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await adminApp.delete();
});

// Each test opens its own School Calendar overlay and leaves it open at
// the end (no test explicitly clicks "Close") — remove any leftover
// overlay from a PREVIOUS test before the next one starts, so
// findSchoolCalendarButton() never piles up a second overlay on top of
// an already-open one. Every test also computes the SAME deterministic
// "this Thursday"/"following Tuesday" dateKeys (relative to today), so
// Lessons/ScheduledEvents seeded by an EARLIER test must be cleared
// before the next one starts — plannerRepository.saveLesson() always
// writes a NEW document id, so without this, getLessonByTeachingSlotId()'s
// own `docs[0]` could return a stale, already-rescheduled Lesson from a
// previous test instead of the current test's own freshly-seeded one.
beforeEach(async () => {
  pendingDialogAction = 'dismiss';
  if (!page) return;
  await page.evaluate(() => document.querySelectorAll('.modal-overlay, .carry-forward-overlay').forEach((el) => el.remove()));
  const [staleLessons, staleEvents] = await Promise.all([
    adminDb.collection('classrooms').doc(CLASSROOM_ID).collection('lessons').get(),
    adminDb.collection('classrooms').doc(CLASSROOM_ID).collection('scheduledEvents').get(),
  ]);
  await Promise.all([...staleLessons.docs, ...staleEvents.docs].map((d) => d.ref.delete()));
});

/** Builds a fresh in-page classroom fixture: Science on Tuesday+Thursday, Period 3, teacher-A — and stashes it on window.__testClassroom. Also returns the real dateKeys for "this Thursday" and "the following Tuesday" relative to today, so assertions can target them precisely regardless of what day this test actually runs on. */
async function buildFixtureClassroom({ singleOccurrenceOnly = false } = {}) {
  return page.evaluate(
    async ({ classroomId, teacherUid, singleOccurrenceOnly }) => {
      const { createClassroom } = await import('/js/models/Classroom.js');
      const { createTimetablePeriod, createTimetableSlot } = await import('/js/models/Timetable.js');
      const { weekdayOfDateKey } = await import('/js/services/timetableService.js');
      const { getTodayDateKey, shiftDateKey } = await import('/js/utils/dateHelpers.js');

      const todayDateKey = getTodayDateKey();
      const todayWeekday = weekdayOfDateKey(todayDateKey);

      // Find the next Tuesday(2) on/after today, and the Thursday(4) right after it — gives us two real, deterministic dateKeys regardless of which day this test actually runs.
      let tuesdayDateKey = todayDateKey;
      while (weekdayOfDateKey(tuesdayDateKey) !== 2) tuesdayDateKey = shiftDateKey(tuesdayDateKey, 1);
      const thursdayDateKey = shiftDateKey(tuesdayDateKey, 2);
      const followingTuesdayDateKey = shiftDateKey(tuesdayDateKey, 7);

      const periods = [createTimetablePeriod({ periodNumber: 1, startTime: '09:00', endTime: '09:40' }), createTimetablePeriod({ periodNumber: 2, startTime: '09:40', endTime: '10:20' }), createTimetablePeriod({ periodNumber: 3, startTime: '10:20', endTime: '11:00' })];
      const slots = [createTimetableSlot({ weekday: 4, periodNumber: 3, subjectId: 'science', teacherUid })];
      if (!singleOccurrenceOnly) slots.push(createTimetableSlot({ weekday: 2, periodNumber: 3, subjectId: 'science', teacherUid }));

      const classroom = createClassroom({
        id: classroomId,
        schoolName: 'Test School',
        gradeSection: 'Grade 8',
        academicYear: '2026-27',
        ownerUid: teacherUid,
        memberUids: [teacherUid],
        members: { [teacherUid]: { role: 'teacher' } },
        learningRecord: { subjects: [] },
        timetable: { periods, slots },
      });

      window.__testClassroom = classroom;
      return { todayDateKey, thursdayDateKey, tuesdayDateKey, followingTuesdayDateKey };
    },
    { classroomId: CLASSROOM_ID, teacherUid: TEACHER_UID, singleOccurrenceOnly }
  );
}

async function mountTimetableView() {
  await page.evaluate(async () => {
    document.getElementById('tt-root')?.remove();
    const container = document.createElement('div');
    container.id = 'tt-root';
    document.body.appendChild(container);
    const { renderTimetableView } = await import('/js/ui/views/TimetableView.js');
    await renderTimetableView(container, { classroom: window.__testClassroom, currentUser: { uid: 'teacher-hr-1', displayName: 'Test Teacher' } });
  });
}

async function seedLesson({ classroomId, dateKey, periodNumber, conceptIds, executedConceptIds = [] }) {
  return page.evaluate(
    async ({ classroomId, dateKey, periodNumber, conceptIds, executedConceptIds }) => {
      const { createLesson } = await import('/js/models/Lesson.js');
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      const teachingSlotId = buildTeachingSlotId(classroomId, dateKey, periodNumber);
      const lesson = createLesson({ classroomId, date: dateKey, teachingSlotId, curriculumUnitId: 'unit-1', conceptIds, executedConceptIds });
      await plannerRepository.saveLesson(classroomId, lesson);
      return lesson;
    },
    { classroomId, dateKey, periodNumber, conceptIds, executedConceptIds }
  );
}

async function fetchLesson(classroomId, dateKey, periodNumber) {
  return page.evaluate(
    async ({ classroomId, dateKey, periodNumber }) => {
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      return plannerRepository.getLessonByTeachingSlotId(classroomId, buildTeachingSlotId(classroomId, dateKey, periodNumber));
    },
    { classroomId, dateKey, periodNumber }
  );
}

function findSchoolCalendarButton() {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('School calendar'));
    if (button) button.click();
    return Boolean(button);
  });
}

async function openMarkADateForm() {
  await page.waitForSelector('.carry-forward-overlay__box', { timeout: 5000 });
  await page.click('button:has-text("+ Mark a date")');
  await page.waitForSelector('.school-calendar__date-range', { timeout: 5000 });
}

async function setHolidayDateRange(startDate, endDate) {
  await page.evaluate(
    ({ startDate, endDate }) => {
      const inputs = [...document.querySelectorAll('.school-calendar__date-range input[type="date"]')];
      const [startInput, endInput] = inputs;
      const setValue = (input, value) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, value);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(startInput, startDate);
      setValue(endInput, endDate);
    },
    { startDate, endDate }
  );
}

test('Single holiday: an affected lesson is rescheduled to the next valid teacher-scoped period, after explicit confirmation', async () => {
  const fixture = await buildFixtureClassroom();
  const seededLesson = await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1', 'c2'] });
  await mountTimetableView();

  assert.ok(await findSchoolCalendarButton(), 'Expected a "School calendar" button on the Timetable toolbar');
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);

  await page.click('.carry-forward-overlay__actions button.btn--primary');

  // The confirmation overlay must appear — real impact, not a silent save.
  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  const summaryText = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay').textContent);
  assert.ok(summaryText.includes('2 concept'), `Expected the confirmation to name 2 affected concepts; got: ${summaryText}`);
  assert.ok(summaryText.includes(fixture.followingTuesdayDateKey.slice(5)) || /→/.test(summaryText), 'Expected a visible original → destination preview');

  await page.click('.holiday-reschedule-overlay button.btn--primary');
  // Saving + rescheduling is async — wait for the overlay to close.
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  const sourceLesson = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  const targetLesson = await fetchLesson(CLASSROOM_ID, fixture.followingTuesdayDateKey, 3);

  assert.deepEqual(sourceLesson.conceptIds, [], 'the source lesson must have its open concepts removed');
  assert.equal(sourceLesson.status, 'rescheduled');
  assert.ok(targetLesson, 'Expected a real Lesson to now exist at the destination slot');
  assert.deepEqual(targetLesson.conceptIds, ['c1', 'c2']);
  assert.equal(targetLesson.rescheduleHistory[0].direction, 'received');
  assert.equal(sourceLesson.rescheduleHistory[0].direction, 'sent');
  assert.equal(sourceLesson.rescheduleHistory[0].moveId, targetLesson.rescheduleHistory[0].moveId);

  // Preservation check — nothing about the move touches unrelated fields that were never part of the contract.
  assert.equal(sourceLesson.id, seededLesson.id, 'the source Lesson document itself is never replaced, only mutated');
});

test('Confirmation cancelled: the holiday, the lesson, and everything else is left completely unchanged', async () => {
  const fixture = await buildFixtureClassroom();
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });
  await mountTimetableView();

  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');

  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  await page.click('.holiday-reschedule-overlay button.btn--ghost'); // Cancel
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 5000 });

  const lessonAfter = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  assert.deepEqual(lessonAfter.conceptIds, ['c1'], 'the lesson must be completely untouched after cancelling');
  assert.deepEqual(lessonAfter.rescheduleHistory, []);

  const exceptions = await page.evaluate(async (classroomId) => {
    const schoolCalendarService = await import('/js/services/schoolCalendarService.js');
    // The exception form's own Save was never actually committed — re-fetch nothing from Firestore (schoolCalendar lives embedded on the classroom doc, never saved here), just confirm the in-memory draft classroom never got an exception pushed onto the REAL classroom object.
    return schoolCalendarService.getCalendarExceptions(window.__testClassroom);
  }, CLASSROOM_ID);
  assert.deepEqual(exceptions, [], 'the Holiday itself must never be saved when the reschedule is cancelled');
});

test('Exam conflict: an explicit decision is required before Confirm becomes available, and the exam itself is never touched', async () => {
  const fixture = await buildFixtureClassroom();
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });

  const examId = await page.evaluate(
    async ({ classroomId, dateKey }) => {
      const { createScheduledEvent } = await import('/js/models/ScheduledEvent.js');
      const scheduledEventRepository = await import('/js/services/scheduledEventRepository.js');
      const event = createScheduledEvent({ classroomId, date: dateKey, startTime: '10:00', endTime: '11:00', title: 'Science Exam', eventType: 'exam', subjectId: 'science' });
      await scheduledEventRepository.saveScheduledEvent(classroomId, event);
      return event.id;
    },
    { classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey }
  );

  await mountTimetableView();
  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');

  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  const overlayText = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay').textContent);
  assert.ok(overlayText.includes('scheduled exam'), `Expected an exam-conflict warning section; got: ${overlayText}`);
  assert.ok(overlayText.includes('Science'), `Expected the affected exam's own subject (resolved via scheduledEventService.resolveEventSubjectTitle()) to be named; got: ${overlayText}`);

  const confirmDisabledBefore = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay button.btn--primary').disabled);
  assert.equal(confirmDisabledBefore, true, 'Confirm must be disabled until the exam conflict is explicitly acknowledged');

  await page.click('.holiday-reschedule-overlay input[type="checkbox"]');
  const confirmDisabledAfter = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay button.btn--primary').disabled);
  assert.equal(confirmDisabledAfter, false, 'Confirm must become available once acknowledged');

  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  const examAfter = await page.evaluate(
    async ({ classroomId, examId }) => {
      const scheduledEventRepository = await import('/js/services/scheduledEventRepository.js');
      return scheduledEventRepository.getScheduledEventById(classroomId, examId);
    },
    { classroomId: CLASSROOM_ID, examId }
  );
  assert.ok(examAfter, 'the exam must still exist, completely untouched — this feature never moves or deletes a ScheduledEvent');
  assert.equal(examAfter.date, fixture.thursdayDateKey);
});

test('No valid destination: the lesson is preserved and surfaced as an unresolved item on the Day/Week indicator and the review panel', async () => {
  const fixture = await buildFixtureClassroom({ singleOccurrenceOnly: true }); // Science ONLY recurs on Thursday — Tuesday is never a candidate at all
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });
  // Thursday itself still recurs weekly, so the search would otherwise
  // just find "next Thursday" — occupy EVERY Thursday within the
  // planner's own 120-day search horizon (DEFAULT_SEARCH_HORIZON_DAYS)
  // with a real, unrelated lesson so none of them is a valid
  // destination either, genuinely exhausting the horizon.
  await page.evaluate(
    async ({ classroomId, holidayThursdayDateKey }) => {
      const { createLesson } = await import('/js/models/Lesson.js');
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const { shiftDateKey } = await import('/js/utils/dateHelpers.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      let dateKey = shiftDateKey(holidayThursdayDateKey, 7); // the FIRST Thursday after the holiday — the holiday's own Thursday is already excluded by its calendar status, not occupancy
      const lessons = [];
      for (let week = 0; week < 19; week += 1) {
        const teachingSlotId = buildTeachingSlotId(classroomId, dateKey, 3);
        lessons.push(createLesson({ classroomId, date: dateKey, teachingSlotId, curriculumUnitId: 'unit-occupying', conceptIds: [] }));
        dateKey = shiftDateKey(dateKey, 7);
      }
      await plannerRepository.saveLessons(classroomId, lessons);
    },
    { classroomId: CLASSROOM_ID, holidayThursdayDateKey: fixture.thursdayDateKey }
  );
  await mountTimetableView();

  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');

  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  const summaryText = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay').textContent);
  assert.ok(/unresolved/i.test(summaryText) || /No open period/i.test(summaryText), `Expected the confirmation to name the unresolved item; got: ${summaryText}`);

  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  const lessonAfter = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  assert.deepEqual(lessonAfter.conceptIds, ['c1'], 'an unresolved lesson must be preserved exactly as-is, never dropped or partially cleared');

  // Review panel — the discoverable route to it. The School Calendar
  // overlay from the save above is still open (saving only re-renders
  // its own content, never closes it) — reopening it here would stack
  // a second, redundant overlay on top.
  await page.waitForSelector('button:has-text("Lessons needing attention")', { timeout: 5000 });
  await page.click('button:has-text("Lessons needing attention")');
  await page.waitForFunction(
    () => {
      const boxes = document.querySelectorAll('.carry-forward-overlay__box');
      const lastBox = boxes[boxes.length - 1];
      return lastBox && !lastBox.textContent.includes('Loading…');
    },
    { timeout: 10000 }
  );
  const panelText = await page.evaluate(() => [...document.querySelectorAll('.carry-forward-overlay__box')].pop().textContent);
  assert.ok(panelText.includes('concept(s) still unplaced'), `Expected the unresolved item to be listed in the review panel; got: ${panelText}`);
});

test('Repeated save/retry is idempotent: re-saving the identical Holiday (editing it, unchanged dates) finds nothing left to move and creates no duplicate moves or audit records', async () => {
  const fixture = await buildFixtureClassroom();
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });
  await mountTimetableView();

  // --- First save: real reschedule happens ---
  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  const sourceAfterFirstSave = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  const targetAfterFirstSave = await fetchLesson(CLASSROOM_ID, fixture.followingTuesdayDateKey, 3);
  assert.deepEqual(sourceAfterFirstSave.conceptIds, []);
  assert.equal(sourceAfterFirstSave.rescheduleHistory.length, 1);
  assert.deepEqual(targetAfterFirstSave.conceptIds, ['c1']);

  // --- Second save: EDIT the same exception (re-save the identical date range via its own "Edit" button) ---
  await page.click('.school-calendar__row-actions button.btn--ghost'); // "Edit" on the one existing exception row
  await page.waitForSelector('.school-calendar__date-range', { timeout: 5000 });
  await page.click('.carry-forward-overlay__actions button.btn--primary'); // Save, unchanged dates

  // Nothing left to move (the source lesson already has zero open concepts) — must save directly, with NO confirmation overlay at all.
  await page.waitForTimeout(500);
  const confirmationAppeared = await page.evaluate(() => Boolean(document.querySelector('.holiday-reschedule-overlay')));
  assert.equal(confirmationAppeared, false, 'Re-saving an already-fully-handled Holiday must skip the confirmation step entirely — there is nothing left to confirm');

  const sourceAfterSecondSave = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  const targetAfterSecondSave = await fetchLesson(CLASSROOM_ID, fixture.followingTuesdayDateKey, 3);
  assert.equal(sourceAfterSecondSave.rescheduleHistory.length, 1, 'no duplicate audit record for the same move');
  assert.equal(sourceAfterSecondSave.id, sourceAfterFirstSave.id);
  assert.equal(targetAfterSecondSave.id, targetAfterFirstSave.id, 'no duplicate destination Lesson document was created');
  assert.deepEqual(targetAfterSecondSave.conceptIds, ['c1'], 'the destination lesson is unaffected by the redundant re-save');
});

test('Date-range holiday: a multi-day holiday reschedules every affected lesson, survives a real reload, and leaves correct persisted destinations + audit history on each', async () => {
  const fixture = await buildFixtureClassroom(); // Science on this Tuesday AND this Thursday
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.tuesdayDateKey, periodNumber: 3, conceptIds: ['tue-c1'] });
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['thu-c1'] });
  await mountTimetableView();

  await findSchoolCalendarButton();
  await openMarkADateForm();
  // A date RANGE spanning both affected dates — Tuesday through Thursday inclusive.
  await setHolidayDateRange(fixture.tuesdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');

  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  const summaryText = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay').textContent);
  assert.ok(summaryText.includes('2 lesson'), `Expected both affected lessons to be named; got: ${summaryText}`);

  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  // Simulate a genuine reload: a fresh container, a fresh renderTimetableView() call. The Lessons themselves are always re-read fresh from Firestore regardless, which is what actually matters here.
  await mountTimetableView();

  const tuesdaySource = await fetchLesson(CLASSROOM_ID, fixture.tuesdayDateKey, 3);
  const thursdaySource = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  assert.deepEqual(tuesdaySource.conceptIds, [], "Tuesday's lesson must have its open concept moved away");
  assert.deepEqual(thursdaySource.conceptIds, [], "Thursday's lesson must have its open concept moved away");
  assert.equal(tuesdaySource.status, 'rescheduled');
  assert.equal(thursdaySource.status, 'rescheduled');

  // Both lessons must land on DIFFERENT destinations — never the same slot, even though both are the same subject/teacher being displaced by the same holiday.
  const tuesdayMove = tuesdaySource.rescheduleHistory[0];
  const thursdayMove = thursdaySource.rescheduleHistory[0];
  assert.equal(tuesdayMove.direction, 'sent');
  assert.equal(thursdayMove.direction, 'sent');
  assert.notEqual(tuesdayMove.toTeachingSlotId, thursdayMove.toTeachingSlotId, 'two different displaced lessons from the same holiday must never collide on the same destination');
  assert.equal(tuesdayMove.exceptionId, thursdayMove.exceptionId, 'both moves must reference the SAME holiday exception that caused them');

  const tuesdayTarget = await fetchLesson(CLASSROOM_ID, tuesdayMove.toDate, 3);
  const thursdayTarget = await fetchLesson(CLASSROOM_ID, thursdayMove.toDate, 3);
  assert.deepEqual(tuesdayTarget.conceptIds, ['tue-c1']);
  assert.deepEqual(thursdayTarget.conceptIds, ['thu-c1']);
  assert.equal(tuesdayTarget.rescheduleHistory[0].direction, 'received');
  assert.equal(thursdayTarget.rescheduleHistory[0].direction, 'received');
});

test('Partially taught lesson: only unexecuted concepts move; completed concepts, teaching history, provenance, feedback and lesson identity are all preserved, verified via real persisted state', async () => {
  const fixture = await buildFixtureClassroom();
  const originalLessonId = await page.evaluate(
    async ({ classroomId, dateKey }) => {
      const { createLesson } = await import('/js/models/Lesson.js');
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      const teachingSlotId = buildTeachingSlotId(classroomId, dateKey, 3);
      const lesson = createLesson({
        classroomId,
        date: dateKey,
        teachingSlotId,
        curriculumUnitId: 'unit-1',
        conceptIds: ['c-executed', 'c-open-1', 'c-open-2', 'c-carried-in'],
        executedConceptIds: ['c-executed'],
        conceptProvenance: { 'c-carried-in': { fromLessonId: 'some-earlier-lesson', fromTeachingSlotId: 'some-earlier-slot', carriedAt: '2026-10-01T00:00:00.000Z' } },
        feedbackSharedAt: '2026-10-20T10:00:00.000Z',
        teacherReflection: 'Went well overall.',
      });
      await plannerRepository.saveLesson(classroomId, lesson);
      return lesson.id;
    },
    { classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey }
  );

  await mountTimetableView();
  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');

  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  const summaryText = await page.evaluate(() => document.querySelector('.holiday-reschedule-overlay').textContent);
  // Only the 3 OPEN concepts (c-open-1, c-open-2, and c-carried-in — itself still open/unexecuted, it was only ever carried IN, never taught) should be named, never the already-executed one.
  assert.ok(summaryText.includes('3 concept'), `Expected exactly 3 open concepts to be named; got: ${summaryText}`);

  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  const sourceAfter = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  // Lesson identity preserved — same document id, never replaced.
  assert.equal(sourceAfter.id, originalLessonId);
  // The executed concept and the executed-work history stay completely untouched.
  assert.deepEqual(sourceAfter.executedConceptIds, ['c-executed']);
  assert.ok(sourceAfter.conceptIds.includes('c-executed'), 'the executed concept must remain on the source lesson');
  // Unrelated metadata (feedback already shared, teacher reflection) must survive — this reschedule never resets fields outside the documented concept-move contract.
  assert.equal(sourceAfter.feedbackSharedAt, '2026-10-20T10:00:00.000Z');
  assert.equal(sourceAfter.teacherReflection, 'Went well overall.');
  // Normal status, not 'rescheduled' — real teaching happened here, so the whole occurrence did not just "move away".
  assert.equal(sourceAfter.status, 'planned');
  // Only the 3 open concepts actually moved.
  assert.deepEqual(sourceAfter.conceptIds, ['c-executed'], 'every OPEN concept must be gone from the source; only the executed one remains');

  const moveRecord = sourceAfter.rescheduleHistory[0];
  assert.deepEqual([...moveRecord.conceptIds].sort(), ['c-carried-in', 'c-open-1', 'c-open-2']);

  const target = await fetchLesson(CLASSROOM_ID, moveRecord.toDate, 3);
  assert.deepEqual([...target.conceptIds].sort(), ['c-carried-in', 'c-open-1', 'c-open-2']);
  // The provenance c-carried-in already had (it was carried in from a THIRD, earlier lesson before this holiday ever happened) must survive the holiday reschedule verbatim — moveConcept()'s own 2026-10 fix carries an EXISTING provenance entry forward rather than discarding it, so "where did this concept originally come from" stays reconstructable even after a second move.
  assert.deepEqual(target.conceptProvenance, { 'c-carried-in': { fromLessonId: 'some-earlier-lesson', fromTeachingSlotId: 'some-earlier-slot', carriedAt: '2026-10-01T00:00:00.000Z' } });
  assert.deepEqual(sourceAfter.conceptProvenance, {}, "the source lesson's own provenance entry for c-carried-in is gone — it no longer holds that concept at all");
});

test('Holiday removal: removing an already-processed Holiday does NOT silently reverse its moves, and the freed-up original slot works normally for new content afterward', async () => {
  const fixture = await buildFixtureClassroom();
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });
  await mountTimetableView();

  // --- Reschedule as usual ---
  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  const sourceAfterReschedule = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  const targetAfterReschedule = await fetchLesson(CLASSROOM_ID, fixture.followingTuesdayDateKey, 3);
  assert.deepEqual(sourceAfterReschedule.conceptIds, []);
  assert.deepEqual(targetAfterReschedule.conceptIds, ['c1']);

  // --- Remove the Holiday exception entirely ---
  pendingDialogAction = 'accept'; // the Remove button's own window.confirm()
  await page.waitForSelector('.school-calendar__row-actions button.btn--danger-text', { timeout: 5000 });
  await page.click('.school-calendar__row-actions button.btn--danger-text');
  await page.waitForTimeout(500); // the removal's own runAction()/loadAndRender() round-trip

  const exceptionsAfterRemoval = await page.evaluate(async () => {
    const schoolCalendarService = await import('/js/services/schoolCalendarService.js');
    return schoolCalendarService.getCalendarExceptions(window.__testClassroom);
  });
  assert.deepEqual(exceptionsAfterRemoval, [], 'the exception itself must actually be gone after Remove');

  // --- No silent reversal: the already-moved lesson must NOT snap back ---
  const sourceAfterRemoval = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  const targetAfterRemoval = await fetchLesson(CLASSROOM_ID, fixture.followingTuesdayDateKey, 3);
  assert.deepEqual(sourceAfterRemoval.conceptIds, [], 'removing the Holiday must NOT automatically move the concept back to its original date');
  assert.equal(sourceAfterRemoval.status, 'rescheduled', 'the source lesson\'s own status is not silently reset either');
  assert.deepEqual(targetAfterRemoval.conceptIds, ['c1'], 'the rescheduled destination must still hold the concept — removing the Holiday does not undo a completed move');
  assert.deepEqual(sourceAfterRemoval.rescheduleHistory, sourceAfterReschedule.rescheduleHistory, 'the audit trail itself is never altered by removing the Holiday that caused it');

  // --- The freed-up original slot (now an ordinary working day again) must behave completely normally for NEW content — no leftover "holiday" state blocks or conflicts with it ---
  const newLessonSaved = await page.evaluate(
    async ({ classroomId, dateKey }) => {
      const { createLesson } = await import('/js/models/Lesson.js');
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      const teachingSlotId = buildTeachingSlotId(classroomId, dateKey, 3);
      // A teacher's own later, unrelated change to this now-ordinary date — must never be silently overwritten or blocked by anything this feature left behind.
      const existing = await plannerRepository.getLessonByTeachingSlotId(classroomId, teachingSlotId);
      existing.curriculumUnitId = 'unit-2-new-teacher-choice';
      await plannerRepository.saveLesson(classroomId, existing);
      return true;
    },
    { classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey }
  );
  assert.ok(newLessonSaved);
  const finalSourceLesson = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  assert.equal(finalSourceLesson.curriculumUnitId, 'unit-2-new-teacher-choice', "the teacher's later edit to the freed-up slot must persist normally, completely unaffected by the earlier Holiday/reschedule history");
});

test('Day/Week unresolved indicator: clicking it directly (not via the School Calendar overlay) opens the review panel without crashing the app — regression test for a real scope bug caught only by visual inspection', async () => {
  // This exact path (renderUnresolvedHolidayIndicator()'s own click
  // handler, defined at renderTimetableView()'s top level, calling
  // openUnresolvedHolidayLessonsPanel()) previously threw
  // "ReferenceError: openUnresolvedHolidayLessonsPanel is not defined"
  // and crashed the ENTIRE app, because that function was accidentally
  // nested inside openSchoolCalendarFlow()'s own closure instead of
  // living at the same top level as its caller. No DOM-assertion test
  // caught this — only driving this exact button, in a real browser,
  // did. This test exists specifically so that regression can never
  // silently return.
  const pageErrors = [];
  const onPageError = (error) => pageErrors.push(error);
  page.on('pageerror', onPageError);

  const fixture = await buildFixtureClassroom({ singleOccurrenceOnly: true });
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });
  // Occupy every future occurrence so the reschedule genuinely has nowhere to go — same technique as the "No valid destination" test above.
  await page.evaluate(
    async ({ classroomId, holidayThursdayDateKey }) => {
      const { createLesson } = await import('/js/models/Lesson.js');
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const { shiftDateKey } = await import('/js/utils/dateHelpers.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      let dateKey = shiftDateKey(holidayThursdayDateKey, 7);
      const lessons = [];
      for (let week = 0; week < 19; week += 1) {
        lessons.push(createLesson({ classroomId, date: dateKey, teachingSlotId: buildTeachingSlotId(classroomId, dateKey, 3), curriculumUnitId: 'unit-occupying', conceptIds: [] }));
        dateKey = shiftDateKey(dateKey, 7);
      }
      await plannerRepository.saveLessons(classroomId, lessons);
    },
    { classroomId: CLASSROOM_ID, holidayThursdayDateKey: fixture.thursdayDateKey }
  );
  await mountTimetableView();

  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });
  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });

  // Close School Calendar entirely and remount, to view the Day/Week grid itself for this exact date.
  await page.evaluate(() => document.querySelectorAll('.modal-overlay, .carry-forward-overlay').forEach((el) => el.remove()));
  await mountTimetableView();
  await page.waitForTimeout(300);

  // The default Week view is anchored on TODAY, which may or may not
  // already include the holiday's own date (the fixture's Thursday can
  // land in either the current or the following week depending on
  // which real weekday "today" happens to be) — click "Next week"
  // (the 3rd button in the date-nav row) at most twice, stopping as
  // soon as the indicator is actually visible.
  let indicatorClicked = false;
  for (let attempt = 0; attempt < 3 && !indicatorClicked; attempt += 1) {
    indicatorClicked = await page.evaluate(() => {
      const btn = document.querySelector('.timetable-view__unresolved-holiday-indicator');
      if (btn) btn.click();
      return Boolean(btn);
    });
    if (!indicatorClicked) {
      await page.evaluate(() => document.querySelectorAll('.timetable-view__date-nav button')[2]?.click());
      await page.waitForTimeout(300);
    }
  }
  assert.ok(indicatorClicked, 'Expected the unresolved indicator to actually be rendered for this date, within a couple of week-navigation steps');
  await page.waitForTimeout(500);

  page.off('pageerror', onPageError);
  assert.deepEqual(pageErrors.map((e) => e.message), [], `Clicking the Day/Week indicator must never throw/crash the app; got: ${pageErrors.map((e) => e.stack).join('\n')}`);

  // And it must have actually opened the real panel, with the real item in it — not just failed silently.
  const panelText = await page.evaluate(() => [...document.querySelectorAll('.carry-forward-overlay__box')].pop()?.textContent || '');
  assert.ok(panelText.includes('concept(s) still unplaced'), `Expected the review panel to actually open with the real unresolved item; got: ${panelText}`);
});

test('Destination-slot conflict safety: a genuine race (another lesson lands on the chosen destination AFTER the plan was computed, BEFORE Confirm is clicked) is caught by the final revalidation — never overwritten', async () => {
  // planAndConfirmHolidaySave() computes its plan (including the chosen
  // destination slot) BEFORE the confirmation overlay is even shown —
  // applyReschedulePlanAndSaveHoliday() only re-checks
  // getLessonByTeachingSlotId() for each destination immediately before
  // actually writing, specifically so a real collision that appears in
  // between (another save, a different browser tab, etc.) is never
  // silently overwritten. This test exercises that exact window.
  const fixture = await buildFixtureClassroom();
  await seedLesson({ classroomId: CLASSROOM_ID, dateKey: fixture.thursdayDateKey, periodNumber: 3, conceptIds: ['c1'] });
  await mountTimetableView();

  await findSchoolCalendarButton();
  await openMarkADateForm();
  await setHolidayDateRange(fixture.thursdayDateKey, fixture.thursdayDateKey);
  await page.click('.carry-forward-overlay__actions button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { timeout: 5000 });

  // The plan has now been computed and is on screen, naming the following Tuesday as the destination — confirmed by the earlier "Single holiday" test. Simulate a genuine race: something else claims that exact slot RIGHT NOW, before Confirm is clicked.
  const raceLessonId = await page.evaluate(
    async ({ classroomId, dateKey }) => {
      const { createLesson } = await import('/js/models/Lesson.js');
      const { buildTeachingSlotId } = await import('/js/services/timetableService.js');
      const plannerRepository = await import('/js/services/plannerRepository.js');
      const racingLesson = createLesson({ classroomId, date: dateKey, teachingSlotId: buildTeachingSlotId(classroomId, dateKey, 3), curriculumUnitId: 'unit-race-winner', conceptIds: ['race-concept'] });
      await plannerRepository.saveLesson(classroomId, racingLesson);
      return racingLesson.id;
    },
    { classroomId: CLASSROOM_ID, dateKey: fixture.followingTuesdayDateKey }
  );

  // NOW click Confirm — the plan still thinks the following Tuesday is free, but it just isn't anymore.
  await page.click('.holiday-reschedule-overlay button.btn--primary');
  await page.waitForSelector('.holiday-reschedule-overlay', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(500);

  // The racing lesson must be COMPLETELY untouched — never merged, never overwritten.
  const racingLessonAfter = await fetchLesson(CLASSROOM_ID, fixture.followingTuesdayDateKey, 3);
  assert.equal(racingLessonAfter.id, raceLessonId);
  assert.deepEqual(racingLessonAfter.conceptIds, ['race-concept'], 'the lesson that won the race must keep its own exact content — never overwritten or merged with the displaced concept');
  assert.equal(racingLessonAfter.curriculumUnitId, 'unit-race-winner');

  // Our own displaced lesson must be marked unresolved instead — preserved, not silently dropped, and NOT claiming a success it didn't actually achieve.
  const sourceAfter = await fetchLesson(CLASSROOM_ID, fixture.thursdayDateKey, 3);
  assert.deepEqual(sourceAfter.conceptIds, ['c1'], 'the source lesson must be preserved completely untouched when its chosen destination turns out to be occupied at the last moment');
  assert.equal(sourceAfter.status, 'planned', 'never marked rescheduled — the move did not actually happen');
  assert.deepEqual(sourceAfter.rescheduleHistory, [], 'no audit record for a move that was safely aborted, not completed');
});
