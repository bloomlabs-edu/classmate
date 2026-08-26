/**
 * scripts/migrateStudentConceptRecords.js
 *
 * Report-only, by design — see this file's own DECISION section below
 * before assuming this backfills the live collection, because it
 * deliberately does not.
 *
 * NOT executed as part of this phase, and not runnable as-is: requires
 * `npm install firebase-admin` (not currently a dependency of this
 * project) and a real service-account credential via
 * GOOGLE_APPLICATION_CREDENTIALS. Never run this against production —
 * that decision belongs to whoever operates this project, made with
 * full awareness of the DECISION section below, not to this script.
 *
 * ---------------------------------------------------------------
 * DECISION: why this script only ever REPORTS, and never WRITES to
 * classrooms/{id}/studentConceptRecords, even in principle
 * ---------------------------------------------------------------
 * Phase N was explicit: no "claim an existing unclaimed record"
 * mechanism should exist. While implementing this script, that
 * created a real correctness problem for an actual write-mode: any
 * legacy record backfilled into the live collection would need a
 * `uid` field, and no real device uid can honestly be attributed to
 * pre-existing legacy data. Writing one with `uid: null` would not
 * just leave it "unclaimed" — because firestore.rules evaluates any
 * write to an ALREADY-EXISTING document id as `update` (never
 * `create`, regardless of client method), and update requires
 * request.auth.uid == resource.data.uid, a uid: null document can
 * NEVER be created or updated by any real device again. That's a
 * strictly worse outcome for that student on that concept than never
 * migrating it at all — and fixing it "the obvious way" (letting the
 * student's first real write claim the null-uid record) is exactly
 * the claim mechanism this phase was told not to build.
 *
 * So: this script computes and reports exactly what
 * scripts/studentConceptRecordsMigrationLogic.js's own
 * computeRecordsToBackfill() would migrate, for a human to review, but
 * stops there. Turning that into a real write is a follow-up decision
 * for whoever operates this project, informed by this report — not
 * something resolved unilaterally in either direction by this phase.
 *
 * All the real decision logic lives in
 * scripts/studentConceptRecordsMigrationLogic.js, which has no
 * firebase-admin dependency at all and is unit-tested directly — this
 * file is only the thin orchestration/reporting around it.
 */

import { computeRecordsToBackfill } from './studentConceptRecordsMigrationLogic.js';

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node scripts/migrateStudentConceptRecords.js <projectId>');
    process.exit(1);
  }

  const admin = await import('firebase-admin');
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const classroomsSnapshot = await db.collection('classrooms').get();
  const report = [];

  for (const classroomDoc of classroomsSnapshot.docs) {
    const classroom = { id: classroomDoc.id, ...classroomDoc.data() };

    const existingSnapshot = await db.collection('classrooms').doc(classroom.id).collection('studentConceptRecords').get();
    const existingRecordIds = new Set(existingSnapshot.docs.map((d) => d.id));

    const toBackfill = computeRecordsToBackfill(classroom, existingRecordIds);
    if (toBackfill.length > 0) {
      report.push({ classroomId: classroom.id, wouldBackfillCount: toBackfill.length, records: toBackfill });
    }
  }

  console.log(JSON.stringify({ mode: 'report-only — see this file’s own DECISION comment for why', classroomsWithPendingBackfill: report }, null, 2));
}

main().catch((error) => {
  console.error('[migrateStudentConceptRecords] Failed:', error);
  process.exit(1);
});
