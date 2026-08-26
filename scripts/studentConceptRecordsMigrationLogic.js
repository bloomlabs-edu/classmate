/**
 * scripts/studentConceptRecordsMigrationLogic.js
 *
 * The pure, dependency-free decision logic behind
 * scripts/migrateStudentConceptRecords.js and
 * scripts/auditStudentConceptRecords.js — deliberately its own file,
 * with no firebase-admin import at all, so it can be unit-tested
 * directly under `node --test` without needing that package installed
 * or a real credential. Mirrors this app's own established split (see
 * services/conceptRecordMerge.js) between pure logic and the thin,
 * SDK-touching script around it.
 */

/**
 * A REPORTING-ONLY label, not a real Firestore document id. The real
 * repository (repositories/firestoreStudentConceptRecordsRepository.js)
 * keys live records on `${uid}_${conceptId}` — the writing DEVICE's own
 * real auth uid, never studentId (see that file's own header comment
 * on why: a studentId-keyed id would be predictable in advance and
 * squattable by a hostile device). Legacy data being reported on here
 * has no associated uid at all — no device ever wrote it via this
 * architecture — so `${studentId}_${conceptId}` is used purely as a
 * human-readable reference label in this script's own output, never as
 * an id this script (or anything else) actually writes to Firestore.
 */
export function buildRecordId(studentId, conceptId) {
  return `${studentId}_${conceptId}`;
}

/**
 * Every legacy classroom.teams[].students[].learningRecord entry,
 * flattened across the whole roster, as a plain
 * {recordId, classroomId, studentId, conceptId, understanding,
 * notebook, helpRequested, updatedAt} list — the audit script's own
 * report, and the migration script's own candidate list before
 * filtering out anything that already exists in the new collection
 * (see computeRecordsToBackfill() below).
 *
 * A student with no learningRecord field at all, or an empty one,
 * contributes nothing — matches this app's own "no entry means the
 * real default, not a row to report" convention.
 */
export function listLegacyRecords(classroom) {
  const rows = [];
  (classroom.teams || []).forEach((team) => {
    (team.students || []).forEach((student) => {
      Object.entries(student.learningRecord || {}).forEach(([conceptId, record]) => {
        rows.push({
          recordId: buildRecordId(student.id, conceptId),
          classroomId: classroom.id,
          studentId: student.id,
          conceptId,
          understanding: record.understanding,
          notebook: record.notebook,
          helpRequested: record.helpRequested,
          updatedAt: record.updatedAt,
        });
      });
    });
  });
  return rows;
}

/**
 * The candidate migration set: every legacy record (listLegacyRecords()
 * above) whose deterministic id is NOT already present in
 * `existingRecordIds` (a Set of ids already fetched from
 * classrooms/{id}/studentConceptRecords by the caller, via one cheap
 * listRecordsForClassroom()-style read before this runs). Computing
 * this is fully idempotent and safe to call any number of times — it
 * never mutates anything itself, only reports what a real write pass
 * would still need to do.
 *
 * `uid` is `null` on every row this returns, because no real device
 * uid can honestly be attributed to pre-existing legacy data — no
 * device has ever written it via this architecture.
 *
 * IMPORTANT, DISCOVERED WHILE IMPLEMENTING THIS (not something Phase
 * N's own approved design anticipated): actually WRITING one of these
 * rows into the live classrooms/{id}/studentConceptRecords collection
 * under its real, normal id would be actively harmful, not just
 * "frozen" — firestore.rules's own studentConceptRecords rule (Phase
 * N, no-claim-mechanism, as explicitly directed) evaluates ANY write
 * to an ALREADY-EXISTING document id as `update`, never `create`,
 * regardless of which client method is used. Once a uid: null document
 * exists at {studentId}_{conceptId}, `request.auth.uid ==
 * resource.data.uid` can never be true for any real device (no uid is
 * ever null) — so the real student would be PERMANENTLY unable to
 * create OR update their own record for that exact concept ever again,
 * a strictly worse outcome than simply not migrating it at all. Fixing
 * this the "obvious" way (letting the first real write "claim" a
 * uid-less record) is exactly the claim mechanism this phase was
 * explicitly told not to build.
 *
 * Because of this, scripts/migrateStudentConceptRecords.js's own
 * apply-mode is intentionally NOT wired to write these rows into the
 * live collection — see that file's own header comment. This function
 * still exists, and is still tested, because it's the honest, real
 * output of "what legacy data would need attention" — turning it into
 * an actual live write is a follow-up decision, not something this
 * phase resolved unilaterally in either direction.
 */
export function computeRecordsToBackfill(classroom, existingRecordIds) {
  return listLegacyRecords(classroom)
    .filter((row) => !existingRecordIds.has(row.recordId))
    .map((row) => ({ ...row, uid: null }));
}
