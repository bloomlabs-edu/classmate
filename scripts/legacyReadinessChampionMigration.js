/**
 * scripts/legacyReadinessChampionMigration.js
 *
 * READ-ONLY DRY-RUN REPORT ONLY. Prints exactly what
 * services/legacyReadinessChampionMigrationService.js's own
 * buildLegacyMigrationDryRunReport() would propose for one real
 * classroom, for a human to review — never writes anything, anywhere.
 *
 * NOT executed as part of this task, and not runnable as-is: requires
 * `npm install firebase-admin` (not currently a dependency of this
 * project — deliberately not added here either, mirroring
 * scripts/auditStudentConceptRecords.js's and
 * scripts/migrateStudentConceptRecords.js's own established precedent)
 * and a real service-account credential via GOOGLE_APPLICATION_CREDENTIALS.
 * Run it with `node scripts/legacyReadinessChampionMigration.js <projectId> <classroomId>`
 * once both of those are in place, and once separately authorized to
 * read that specific classroom's real data.
 *
 * ---------------------------------------------------------------
 * DECISION: why this script has no "apply" mode at all, even gated
 * behind a flag — mirrors scripts/migrateStudentConceptRecords.js's own
 * DECISION section precedent exactly: that is a deliberate, separate
 * choice, not an oversight.
 * ---------------------------------------------------------------
 * services/legacyReadinessChampionMigrationService.js's own
 * applyLegacyReadinessChampionMigration() is a real, fully-tested, pure
 * function — it takes a plain in-memory classroom object and an acting
 * uid, and returns what it applied; see that file's own tests. But
 * turning that pure function into a script that reads ONE real
 * classroom document, applies it, and writes the result back to
 * Firestore is a meaningfully bigger and riskier thing than anything
 * else in this preparation: every other write in this entire app goes
 * through the live, interactive UI (one teacher, one action, one
 * document, reviewed on screen before it happens) — nothing in this
 * codebase today performs an unattended batch write to a real
 * classroom document, and this migration would be the first. That
 * script — with its own read-modify-write safety (e.g. re-reading the
 * document immediately before writing to reduce the window for a
 * concurrent teacher edit to be silently clobbered, since Firestore
 * transactions are not used elsewhere in this codebase either), its own
 * explicit confirmation flag, and its own operator-facing output
 * (exactly how many students/notebooks were touched, in which
 * classroom) — does not exist yet. Building it is the kind of
 * separately-authorized step this preparation was asked to prepare FOR,
 * not to take unilaterally by bundling it into this read-only report.
 *
 * All the real decision logic — both the dry-run classification and the
 * (not-wired-up-to-Firestore-here) apply function — lives in
 * services/legacyReadinessChampionMigrationService.js, which has no
 * firebase-admin dependency at all and is unit-tested directly against
 * synthetic fixtures — this file is only the thin, read-only
 * orchestration around its own dry-run report, same split as
 * scripts/auditStudentConceptRecords.js.
 */

import { buildLegacyMigrationDryRunReport } from '../js/services/legacyReadinessChampionMigrationService.js';

async function main() {
  const [projectId, classroomId] = process.argv.slice(2);
  if (!projectId || !classroomId) {
    console.error('Usage: node scripts/legacyReadinessChampionMigration.js <projectId> <classroomId>');
    process.exit(1);
  }

  // Deferred, dynamic import so this file can still be imported (for
  // buildLegacyMigrationDryRunReport, re-exported above) in an
  // environment without firebase-admin installed, without throwing at
  // import time.
  const admin = await import('firebase-admin');
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // A single, explicit .get() — one document, one read, never a
  // collection scan, never a write of any kind.
  const classroomDoc = await db.collection('classrooms').doc(classroomId).get();
  if (!classroomDoc.exists) {
    console.error(`[legacyReadinessChampionMigration] No classroom found with id "${classroomId}".`);
    process.exit(1);
  }

  const classroom = { id: classroomDoc.id, ...classroomDoc.data() };
  const report = buildLegacyMigrationDryRunReport(classroom);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[legacyReadinessChampionMigration] Failed:', error);
  process.exit(1);
});
