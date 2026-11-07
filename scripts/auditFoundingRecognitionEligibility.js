/**
 * scripts/auditFoundingRecognitionEligibility.js
 *
 * READ-ONLY DRY-RUN REPORT ONLY. Prints exactly what
 * services/notebookFoundingRecognitionService.js's own
 * auditFoundingRecognitionEligibility() and isLikelyTestOrSandboxClassroom()
 * would report for one or every real classroom, for a human to review —
 * this file performs ZERO writes of any kind, to any classroom, ever.
 * There is no "fail safely" mode that falls back to writing anything;
 * every failure path below exits without having touched Firestore at
 * all beyond the read(s) this report itself needs.
 *
 * This file NEVER imports or calls applyFoundingRecognition() — not
 * behind a flag, not commented out, not even referenced by name below
 * except in this sentence. See scripts/legacyReadinessChampionMigration.js's
 * own "DECISION: why this script has no apply mode at all" section for
 * the identical reasoning, which applies here without modification:
 * turning a pure, tested function into an unattended batch write to a
 * real classroom document is a meaningfully bigger, separately-
 * authorized step than preparing the report that would justify it.
 *
 * ALL the real eligibility logic lives in
 * services/notebookFoundingRecognitionService.js, which has no
 * firebase-admin dependency at all and is unit-tested directly against
 * synthetic fixtures (tests/services/notebookFoundingRecognitionService.test.js)
 * — this file is only the thin, read-only orchestration around that
 * service's own audit function, same split as
 * scripts/legacyReadinessChampionMigration.js and
 * scripts/auditStudentConceptRecords.js before it. Nothing about
 * eligibility is reimplemented or approximated here.
 *
 * NOT executed as part of this task, and not runnable as-is: requires
 * `npm install firebase-admin` (not currently a dependency of this
 * project — deliberately not added here, mirroring
 * scripts/legacyReadinessChampionMigration.js's own established
 * precedent) and a real service-account credential via
 * GOOGLE_APPLICATION_CREDENTIALS. If firebase-admin is not installed,
 * or no classroom/project id is supplied, this script exits cleanly
 * with a clear message and a non-zero exit code — it NEVER falls back
 * to any kind of write path, "safely" or otherwise; failing safely
 * here means failing to produce a report, never failing open into a
 * write.
 *
 * USAGE:
 *   node scripts/auditFoundingRecognitionEligibility.js <projectId> [classroomId]
 * With a classroomId: audits exactly that one classroom. Without one:
 * audits EVERY classroom in the `classrooms` collection — this performs
 * one cheap `.count()` aggregate query first and prints it before
 * reading any document content, so an operator sees the scale of the
 * org-wide read before it happens.
 *
 * SAFE TO RUN REPEATEDLY: deterministic for a given classroom's own
 * stored data (same inputs, same report, every time) and idempotent in
 * the sense that matters here — running it ten times in a row changes
 * nothing about any classroom, ever, because it changes nothing at
 * all. Every count in its output is explicitly a PROPOSAL — "would be
 * recognized if applyFoundingRecognition() were separately authorized
 * and run" — never an actual award; no field in this report's own
 * shape should ever be read as "this already happened."
 *
 * DUPLICATE/OVERLAPPING CLASSROOM DETECTION — org-wide mode only.
 * Flags EXACT normalized-name matches for different (classroomId,
 * studentId) pairs, the same conservative detector used in the
 * organisation-wide read-only audit this feature was built from. Never
 * merges, never excludes, never treats two such records as the same
 * person — purely a "needs a human to look at this" signal, listed
 * alongside the classroom/student ids that triggered it. Per that
 * audit's own real finding (two "CMS MH Road" classrooms named "7A"
 * with different owners, created two months apart, sharing 8+ exact
 * student names), this detector catches real, found issues
 * mechanically; it is NOT a general identity-resolution system and
 * does not attempt fuzzy/near-miss matching (e.g. "Varalaxmi" vs
 * "Varalakshmi") — those require a human judgment call this script
 * does not make.
 *
 * TEST/SANDBOX CLASSIFICATION — TWO INDEPENDENT SIGNALS, reported
 * separately, never merged into one flag:
 *   - `classification` ('confirmed_real' | 'confirmed_test' |
 *     'needs_review') — read from the Option B human-reviewed
 *     registry (./foundingRecognitionClassroomRegistry.js, loaded
 *     once in main() below and passed into every report function as a
 *     plain parameter, never imported by the service itself — see
 *     that registry module's own header comment for exactly why).
 *     This is the AUTHORITATIVE signal applyFoundingRecognition()
 *     itself gates on; `needs_review` is both the default for any
 *     classroom id absent from the registry and the result for a
 *     present-but-malformed entry — never guessed into either
 *     confirmed state.
 *   - `flaggedAsLikelyTestOrSandbox` — the ORIGINAL name-pattern
 *     heuristic, now reported purely as a non-blocking WARNING
 *     alongside the registry's own classification (even for a
 *     classroom already confirmed real) — it has known, confirmed
 *     false positives ("Trial Bay Public School") and false negatives
 *     ("QA", "staging", "dummy" naming conventions are not caught), so
 *     neither a true nor a false value here is proof of anything on
 *     its own; it exists to prompt a second look, nothing more.
 * A classroom is NEVER silently excluded from this report for either
 * signal — `classification`/`flaggedAsLikelyTestOrSandbox` are always
 * present on every classroom's own report entry, alongside its full
 * proposed-eligibility numbers, regardless of what either says.
 */

import { fileURLToPath } from 'url';
import { auditFoundingRecognitionEligibility, FOUNDING_RECOGNITION_CUTOFF_ISO, FOUNDING_RECOGNITION_CLASSIFICATIONS } from '../js/services/notebookFoundingRecognitionService.js';
import { loadFoundingRecognitionClassroomRegistry, getClassroomClassificationDetail } from './foundingRecognitionClassroomRegistry.js';

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '');
}

function allStudents(classroom) {
  const out = [];
  for (const team of classroom.teams || []) {
    for (const student of team.students || []) out.push({ ...student, teamId: team.id, teamName: team.name });
  }
  return out;
}

function buildClassroomReport(classroom, registry = {}) {
  const classificationDetail = getClassroomClassificationDetail(registry, classroom.id);
  const audit = auditFoundingRecognitionEligibility(classroom, { classification: classificationDetail.classification, classificationDetail });
  const notebookCount = new Set((classroom.checkpoints || []).map((cp) => `${cp.subjectId}::${cp.notebookTypeId}`)).size;

  const eligibleStudentIds = new Set(audit.eligible.map((e) => e.studentId));

  return {
    classroomId: classroom.id,
    classroomName: classroom.classroomName || classroom.schoolName || classroom.gradeSection || '(unnamed)',
    schoolName: classroom.schoolName || null,
    gradeSection: classroom.gradeSection || null,
    classification: classificationDetail.classification,
    classificationReason: classificationDetail.reason,
    classificationReviewedBy: classificationDetail.reviewedBy,
    classificationReviewedAt: classificationDetail.reviewedAt,
    flaggedAsLikelyTestOrSandbox: audit.isLikelyTestOrSandboxClassroom,
    cutoffIso: FOUNDING_RECOGNITION_CUTOFF_ISO,
    studentCount: allStudents(classroom).length,
    notebooksConfigured: notebookCount,
    proposedEligibleStudentCount: eligibleStudentIds.size,
    proposedAwardCount_notebookPairs: audit.eligible.length,
    excludedBecauseIncomplete_notebookPairs: audit.incomplete.length,
    excludedBecauseBelowFiveCheckpointMinimum_notebookPairs: audit.belowMinimumCheckpoints.length,
    excludedBecauseInsufficientEvidence_notebookPairs: audit.insufficientEvidence.length,
    alreadyRecognized_notebookPairs: audit.alreadyRecognized.length,
    proposedAwards: audit.eligible.map((e) => ({
      studentId: e.studentId,
      studentName: e.studentName,
      subjectId: e.subjectId,
      notebookTypeId: e.notebookTypeId,
      requiredCheckpointCount: e.completeness.totalRequired,
      onTimeCount: e.completeness.onTimeCount,
      lateCount: e.completeness.lateCount,
    })),
    exclusionDetail: {
      incomplete: audit.incomplete.map((e) => ({ studentId: e.studentId, studentName: e.studentName, subjectId: e.subjectId, notebookTypeId: e.notebookTypeId, reason: `${e.completeness.notCountingCount} of ${e.completeness.totalRequired} required checkpoints not submitted or returned/incomplete` })),
      belowMinimumCheckpoints: audit.belowMinimumCheckpoints.map((e) => ({ studentId: e.studentId, studentName: e.studentName, subjectId: e.subjectId, notebookTypeId: e.notebookTypeId, reason: `only ${e.completeness.totalRequired} checkpoint(s) created before the cutoff -- below the 5-checkpoint minimum` })),
      insufficientEvidence: audit.insufficientEvidence.map((e) => ({ studentId: e.studentId, studentName: e.studentName, subjectId: e.subjectId, notebookTypeId: e.notebookTypeId, reason: `${e.completeness.insufficientEvidenceCount} checkpoint(s) have a missing/unparseable createdAt -- cannot reliably classify as before or after the cutoff, never guessed` })),
      alreadyRecognized: audit.alreadyRecognized.map((e) => ({ studentId: e.studentId, studentName: e.studentName, subjectId: e.subjectId, notebookTypeId: e.notebookTypeId, reason: 'a Founding Recognition entry already exists for this exact notebook -- applying again would be skipped as a duplicate' })),
    },
  };
}

function findPossibleDuplicateIdentities(classroomReports, rawClassrooms) {
  const nameEntries = [];
  for (const classroom of rawClassrooms) {
    const classroomName = classroom.classroomName || classroom.schoolName || classroom.gradeSection || '(unnamed)';
    for (const student of allStudents(classroom)) {
      nameEntries.push({ normalizedName: normalizeName(student.name), rawName: student.name, studentId: student.id, classroomId: classroom.id, classroomName });
    }
  }
  const byName = new Map();
  for (const entry of nameEntries) {
    if (!byName.has(entry.normalizedName)) byName.set(entry.normalizedName, []);
    byName.get(entry.normalizedName).push(entry);
  }
  return [...byName.values()]
    .filter((group) => group.length > 1 && new Set(group.map((g) => g.studentId)).size > 1 && new Set(group.map((g) => g.classroomId)).size > 1)
    .map((group) => ({ normalizedName: group[0].normalizedName, occurrences: group.map(({ studentId, rawName, classroomId, classroomName }) => ({ studentId, rawName, classroomId, classroomName })) }));
}

function buildOrgWideReport(rawClassrooms, registry = {}) {
  const classroomReports = rawClassrooms.map((classroom) => buildClassroomReport(classroom, registry));
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    writesPerformed: 0,
    note: 'DRY RUN ONLY. Every "proposed" field below describes what applyFoundingRecognition() WOULD do if separately authorized and run -- nothing in this report has been applied. `classification` comes from the Option B human-reviewed registry (foundingRecognitionClassroomRegistry.json) and is the authoritative gate applyFoundingRecognition() itself enforces; `flaggedAsLikelyTestOrSandbox` is the original name-pattern heuristic, now reported purely as a non-blocking warning alongside it, with known false-positive and false-negative gaps -- see this script\'s own header comment and the feature\'s handover report.',
    cutoffIso: FOUNDING_RECOGNITION_CUTOFF_ISO,
    classroomsInspected: classroomReports.length,
    totalProposedEligibleStudents: classroomReports.reduce((sum, c) => sum + c.proposedEligibleStudentCount, 0),
    totalProposedAwards_notebookPairs: classroomReports.reduce((sum, c) => sum + c.proposedAwardCount_notebookPairs, 0),
    classroomsByClassification: {
      [FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_REAL]: classroomReports.filter((c) => c.classification === FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_REAL).map((c) => ({ classroomId: c.classroomId, classroomName: c.classroomName })),
      [FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_TEST]: classroomReports.filter((c) => c.classification === FOUNDING_RECOGNITION_CLASSIFICATIONS.CONFIRMED_TEST).map((c) => ({ classroomId: c.classroomId, classroomName: c.classroomName })),
      [FOUNDING_RECOGNITION_CLASSIFICATIONS.NEEDS_REVIEW]: classroomReports.filter((c) => c.classification === FOUNDING_RECOGNITION_CLASSIFICATIONS.NEEDS_REVIEW).map((c) => ({ classroomId: c.classroomId, classroomName: c.classroomName })),
    },
    classroomsFlaggedAsLikelyTestOrSandbox: classroomReports.filter((c) => c.flaggedAsLikelyTestOrSandbox).map((c) => ({ classroomId: c.classroomId, classroomName: c.classroomName })),
    classrooms: classroomReports,
    possibleDuplicateIdentitiesAcrossClassrooms: findPossibleDuplicateIdentities(classroomReports, rawClassrooms),
  };
}

async function main() {
  const [projectId, classroomId] = process.argv.slice(2);
  if (!projectId) {
    console.error('Usage: node scripts/auditFoundingRecognitionEligibility.js <projectId> [classroomId]');
    console.error('  With classroomId: audits exactly that one classroom.');
    console.error('  Without classroomId: audits EVERY classroom in the `classrooms` collection (read-only).');
    process.exit(1);
  }

  // Deferred, dynamic import so this file can still be imported (for
  // buildClassroomReport/buildOrgWideReport, usable directly in a test)
  // in an environment without firebase-admin installed, without
  // throwing at import time -- failing safely means failing to start,
  // never falling back to a write.
  let admin;
  try {
    admin = await import('firebase-admin');
  } catch (error) {
    console.error('[auditFoundingRecognitionEligibility] firebase-admin is not installed in this environment. Install it (as an isolated, read-only diagnostic dependency, never inside a tracked worktree\'s own package.json) before running this script against real data. This script performs ZERO writes regardless of this failure.');
    process.exit(1);
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // Loaded once, from the local, version-controlled registry file --
  // never a Firestore read. See foundingRecognitionClassroomRegistry.js's
  // own header comment for why this file is the one and only place
  // that registry is ever loaded from.
  const registry = loadFoundingRecognitionClassroomRegistry();

  if (classroomId) {
    // A single, explicit .get() -- one document, one read, never a write.
    const classroomDoc = await db.collection('classrooms').doc(classroomId).get();
    if (!classroomDoc.exists) {
      console.error(`[auditFoundingRecognitionEligibility] No classroom found with id "${classroomId}".`);
      process.exit(1);
    }
    const classroom = { id: classroomDoc.id, ...classroomDoc.data() };
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, writesPerformed: 0, ...buildClassroomReport(classroom, registry) }, null, 2));
    return;
  }

  // Org-wide mode: one cheap .count() aggregate first (reads no document
  // content at all) so the scale of the read is visible before it
  // happens, then exactly one .get() across the whole collection.
  const countSnap = await db.collection('classrooms').count().get();
  console.error(`[auditFoundingRecognitionEligibility] No classroomId given -- auditing all ${countSnap.data().count} classrooms in the collection (read-only).`);

  const snap = await db.collection('classrooms').get();
  const rawClassrooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(JSON.stringify(buildOrgWideReport(rawClassrooms, registry), null, 2));
}

// Only auto-runs when this file is executed directly (`node
// scripts/auditFoundingRecognitionEligibility.js ...`), never when
// imported as a module (e.g. by this script's own tests, which import
// buildClassroomReport/buildOrgWideReport/findPossibleDuplicateIdentities
// below directly) — importing this file must never itself trigger a
// Firestore connection attempt or a process.exit().
const isRunDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isRunDirectly) {
  main().catch((error) => {
    console.error('[auditFoundingRecognitionEligibility] Failed:', error);
    process.exit(1);
  });
}

export { buildClassroomReport, buildOrgWideReport, findPossibleDuplicateIdentities };
