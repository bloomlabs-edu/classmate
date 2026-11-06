/**
 * tests/ui/notebookStatusParity.emulator.test.js
 *
 * End-to-end regression test for the "Raban M" production bug, against
 * a REAL Firestore emulator (not an in-memory fixture) — proves the
 * full async path services/studentPortalDataService.js's own
 * getNotebookStatusForCurrentStudent() actually takes (device profile
 * -> Firestore read -> services/notebookStatusService.js) produces the
 * exact same result as the teacher-facing path reads from the same
 * underlying document, for the exact scenario that broke in
 * production: a student with several checkpoint-tracked notebooks
 * "Not Submitted" and ZERO WorkRequests in the whole classroom.
 *
 * Requires the Firestore emulator running:
 *   firebase emulators:start --only firestore --project classmate-302c2
 *
 * Never touches production — services/firestoreEnvironment.js's own
 * determineFirestoreTarget() defaults any non-production hostname
 * (including this test's own 127.0.0.1 static server) to the local
 * emulator; this file's own seeding additionally talks to the emulator
 * directly via firebase-admin + FIRESTORE_EMULATOR_HOST, never the real
 * backend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONTENT_TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const PROJECT_ID = 'classmate-302c2';
const CLASSROOM_ID = 'notebook-parity-test-classroom';
const STUDENT_ID = 'raban-m';

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

function buildClassroomDoc() {
  return {
    id: CLASSROOM_ID,
    memberUids: [],
    teams: [
      {
        id: 'team-1',
        name: 'Team A',
        isUngrouped: false,
        students: [{ id: STUDENT_ID, name: 'Raban M', bucket: 'green', badges: [], history: [], score: 0, notes: [] }],
      },
    ],
    notebookConfig: {
      subjects: [{ id: 'subj-sci', name: 'Science' }],
      notebookTypes: [{ id: 'type-classwork', subjectId: 'subj-sci', name: 'Classwork', trackingMode: 'checkpoint', dailySettings: null }],
    },
    // THE EXACT "RABAN M" CONDITION: several checkpoints with NO student
    // record at all (sparse -> Not Submitted), and zero WorkRequests
    // anywhere in the classroom -- the old, buggy student-profile/alerts
    // reads (workRequestService-only) would report zero outstanding work
    // here, while the teacher's own Notebook Tracker correctly shows
    // three "Not Submitted" cells.
    checkpoints: [
      { id: 'cp-1', subjectId: 'subj-sci', notebookTypeId: 'type-classwork', title: 'Unit 1', description: '', givenDate: '2026-10-01', dueDate: '', order: 0, createdAt: '2026-10-01T00:00:00.000Z', records: [] },
      { id: 'cp-2', subjectId: 'subj-sci', notebookTypeId: 'type-classwork', title: 'Unit 2', description: '', givenDate: '2026-10-01', dueDate: '', order: 1, createdAt: '2026-10-01T00:00:00.000Z', records: [] },
      { id: 'cp-3', subjectId: 'subj-sci', notebookTypeId: 'type-classwork', title: 'Unit 3', description: '', givenDate: '2026-10-01', dueDate: '', order: 2, createdAt: '2026-10-01T00:00:00.000Z', records: [] },
    ],
    workRequests: [],
    assignmentConfig: { categories: [] },
    assignments: [],
    assignmentCheckpoints: [],
    learningRecord: { subjects: [] },
  };
}

let server;
let port;
let browser;
let page;
let app;
let db;

test.before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = admin.initializeApp({ projectId: PROJECT_ID }, 'notebook-status-parity-test');
  db = getFirestore(app);
  await db.collection('classrooms').doc(CLASSROOM_ID).set(buildClassroomDoc());

  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
  page = await browser.newPage();
});

test.after(async () => {
  await db.collection('classrooms').doc(CLASSROOM_ID).delete();
  await app.delete();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test('PARITY: the student portal’s own Firestore-backed notebook status read agrees with the shared service, for the exact "zero WorkRequests, several unsubmitted checkpoints" condition that broke in production', async () => {
  await page.goto(`http://127.0.0.1:${port}/index.html`);

  const result = await page.evaluate(
    async ({ classroomId, studentId }) => {
      const studentDeviceService = await import('/js/services/studentDeviceService.js');
      const studentPortalDataService = await import('/js/services/studentPortalDataService.js');
      const notebookStatusService = await import('/js/services/notebookStatusService.js');

      studentDeviceService.addApprovedProfile({ studentId, classroomId });
      studentDeviceService.setActiveProfile({ studentId });

      // The student portal's own real path: device profile -> live
      // Firestore read (the emulator, per determineFirestoreTarget()'s
      // own non-production-hostname default) -> notebookStatusService.
      const studentSideResult = await studentPortalDataService.getNotebookStatusForCurrentStudent();

      // The teacher-facing path's own ground truth, fetched via the
      // exact same one-time Firestore read workspaceService itself
      // uses, then run through the identical shared service function
      // ui/views/StudentProfileView.js's own Notebooks tab calls.
      const workspaceService = await import('/js/services/workspaceService.js');
      const classroom = await workspaceService.getClassroomOnce(classroomId);
      const teacherSideResult = notebookStatusService.getNotebookStatusForStudent(classroom, studentId);

      return {
        studentSideSummary: studentSideResult.summary,
        teacherSideSummary: teacherSideResult.summary,
        classroomLoaded: !!classroom,
      };
    },
    { classroomId: CLASSROOM_ID, studentId: STUDENT_ID }
  );

  assert.equal(result.classroomLoaded, true, 'the emulator-seeded classroom must actually be readable over the real Firestore client SDK');

  // THE ACTUAL BUG, reproduced and fixed: this must be 3, never 0.
  assert.equal(result.teacherSideSummary.awaitingSubmission, 3, 'teacher-side ground truth: three checkpoints with no record are Not Submitted');
  assert.equal(result.studentSideSummary.awaitingSubmission, 3, 'student portal must report the SAME count the teacher sees for this student — this is the literal reported bug');

  assert.deepEqual(result.studentSideSummary, result.teacherSideSummary, 'teacher and student views must never disagree about the same student’s own notebook status');
});
