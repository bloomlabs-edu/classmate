/**
 * scripts/recognitionIntegrityAudit.js
 *
 * READ-ONLY. Never writes anything, anywhere. Produces the per-student
 * recognition-integrity report (Completion Star eligibility + Readiness
 * Champion notebook-level backfill eligibility + reversal/ledger
 * verification) for one real classroom, so a human can decide what
 * correction, if any, to authorize — this script never decides or acts
 * on its own.
 *
 * NOT executed as part of this task, and not runnable as-is: requires
 * `npm install firebase-admin` (not currently a dependency of this
 * project — deliberately not added here either, mirroring
 * scripts/auditStudentConceptRecords.js's own established precedent) and
 * a real service-account credential via GOOGLE_APPLICATION_CREDENTIALS.
 * Run it with `node scripts/recognitionIntegrityAudit.js <projectId> <classroomId>`
 * once both of those are in place, and once separately authorized to
 * read that specific classroom's real data.
 *
 * All the real decision logic lives in
 * scripts/recognitionIntegrityAuditLogic.js, which has no firebase-admin
 * dependency at all and is unit-tested directly — this file is only the
 * thin orchestration around it, same split as
 * scripts/auditStudentConceptRecords.js.
 */

import { buildRecognitionIntegrityReport } from './recognitionIntegrityAuditLogic.js';

async function main() {
  const [projectId, classroomId] = process.argv.slice(2);
  if (!projectId || !classroomId) {
    console.error('Usage: node scripts/recognitionIntegrityAudit.js <projectId> <classroomId>');
    process.exit(1);
  }

  // Deferred, dynamic import so this file can still be imported (for
  // buildRecognitionIntegrityReport, re-exported above) in an
  // environment without firebase-admin installed, without throwing at
  // import time.
  const admin = await import('firebase-admin');
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // A single, explicit .get() — one document, one read, never a
  // collection scan, never a write of any kind.
  const classroomDoc = await db.collection('classrooms').doc(classroomId).get();
  if (!classroomDoc.exists) {
    console.error(`[recognitionIntegrityAudit] No classroom found with id "${classroomId}".`);
    process.exit(1);
  }

  const classroom = { id: classroomDoc.id, ...classroomDoc.data() };
  const report = buildRecognitionIntegrityReport(classroom);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[recognitionIntegrityAudit] Failed:', error);
  process.exit(1);
});
