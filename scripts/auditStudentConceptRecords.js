/**
 * scripts/auditStudentConceptRecords.js
 *
 * READ-ONLY. Never writes anything, anywhere. Answers the question
 * Phase N's own investigation raised but couldn't confirm without a
 * real production read: does classrooms/*.teams[].students[].learningRecord
 * actually contain any real, non-default data anywhere, given that the
 * write path into it has required classroom memberUids (which no real
 * anonymous student device has ever had) since this feature shipped?
 *
 * NOT executed as part of this phase, and not runnable as-is: requires
 * `npm install firebase-admin` (not currently a dependency of this
 * project — deliberately not added by this phase either, since it's
 * only needed if/when someone actually decides to run this) and a
 * real service-account credential via GOOGLE_APPLICATION_CREDENTIALS.
 * Run it with `node scripts/auditStudentConceptRecords.js` once both
 * of those are in place, against a project id passed as the one CLI
 * argument.
 *
 * All the real decision logic lives in
 * scripts/studentConceptRecordsMigrationLogic.js (listLegacyRecords()),
 * which has no firebase-admin dependency at all and is unit-tested
 * directly — this file is only the thin orchestration around it.
 */

import { listLegacyRecords } from './studentConceptRecordsMigrationLogic.js';

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node scripts/auditStudentConceptRecords.js <projectId>');
    process.exit(1);
  }

  // Deferred, dynamic import so this file can still be imported by
  // tests (for listLegacyRecords, re-exported above) in an environment
  // without firebase-admin installed, without throwing at import time.
  const admin = await import('firebase-admin');
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const classroomsSnapshot = await db.collection('classrooms').get();
  let totalClassrooms = 0;
  let totalLegacyRecords = 0;
  const perClassroom = [];

  for (const classroomDoc of classroomsSnapshot.docs) {
    const classroom = { id: classroomDoc.id, ...classroomDoc.data() };
    const legacyRecords = listLegacyRecords(classroom);
    totalClassrooms += 1;
    totalLegacyRecords += legacyRecords.length;
    if (legacyRecords.length > 0) {
      perClassroom.push({ classroomId: classroom.id, legacyRecordCount: legacyRecords.length });
    }
  }

  console.log(JSON.stringify({ totalClassrooms, totalLegacyRecords, classroomsWithLegacyData: perClassroom }, null, 2));
}

main().catch((error) => {
  console.error('[auditStudentConceptRecords] Failed:', error);
  process.exit(1);
});
