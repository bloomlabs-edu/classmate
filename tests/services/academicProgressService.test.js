import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createAssessment } from '../../js/models/Assessment.js';
import { createAssessmentSubject } from '../../js/models/AssessmentSubject.js';
import { createNotebookSubject } from '../../js/models/NotebookSubject.js';
import { createNotebookType } from '../../js/models/NotebookType.js';
import * as assessmentService from '../../js/services/assessmentService.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as academicProgressService from '../../js/services/academicProgressService.js';
import { PASS_MARK_PERCENT, GREEN_THRESHOLD_PERCENT } from '../../js/config/assessmentMarksColorConfig.js';

// -----------------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------------

function buildClassroom({ academicYear = '2026-27' } = {}) {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1', academicYear });
  classroom.learningRecord.subjects.push(
    { id: 'record-english', subjectId: 'english', title: 'English', units: [] },
    { id: 'record-maths', subjectId: 'mathematics', title: 'Mathematics', units: [] },
    { id: 'record-science', subjectId: 'science', title: 'Science', units: [] }
  );
  classroom.teams = [
    {
      id: 't1',
      name: 'Team 1',
      students: [
        { id: 's1', name: 'Asha', learningRecord: {} },
        { id: 's2', name: 'Blessy', learningRecord: {} },
      ],
    },
  ];
  return classroom;
}

/**
 * subjects: [{ subjectId /* LearningSubject.id or a raw canonical id *\/, maximumMarks, results: { [studentId]: {marks, absent} } }]
 */
function addAssessment(classroom, { title, status = 'Published', academicYear, date, type = 'Mid Term', examinationCycleId = null, passMarkPercent = null, subjects }) {
  const assessmentSubjects = subjects.map((s) => createAssessmentSubject({ subjectId: s.subjectId, maximumMarks: s.maximumMarks ?? 100 }));
  const assessment = createAssessment({
    classroomId: classroom.id,
    title,
    type,
    academicYear: academicYear ?? classroom.academicYear,
    date,
    status,
    assessmentSubjects,
    examinationCycleId,
    passMarkPercent,
  });
  classroom.assessments.push(assessment);

  assessment.assessmentSubjects.forEach((assessmentSubject, idx) => {
    const spec = subjects[idx];
    Object.entries(spec.results || {}).forEach(([studentId, result]) => {
      assessmentService.recordStudentMarks(assessmentSubject, studentId, result);
    });
  });

  return assessment;
}

const ENGLISH = 'record-english';
const MATHS = 'record-maths';
const SCIENCE = 'record-science';

// =========================================================================
// §4.1 — Evidence layer
// =========================================================================

test('E1: a Draft assessment with a real StudentResult is excluded entirely from evidence', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', status: 'Draft', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: { s1: { marks: 80 } } }] });

  const evidence = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(evidence.length, 0);
});

test('E2: a Locked assessment is excluded (only Published is eligible, per locked guardrail #2)', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', status: 'Locked', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: { s1: { marks: 80 } } }] });

  const evidence = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(evidence.length, 0);
});

test('E3: no StudentResult row at all for the student -> entered:false, percent:null, outcome:not_assessed', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: {} }] });

  const [row] = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(row.entered, false);
  assert.equal(row.absent, false);
  assert.equal(row.percent, null);
  assert.equal(row.outcome, 'not_assessed');
});

test('E4: absent:true, marks:null -> absent:true, percent:null, outcome:not_assessed', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: { s1: { absent: true, marks: null } } }] });

  const [row] = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(row.entered, true);
  assert.equal(row.absent, true);
  assert.equal(row.percent, null);
  assert.equal(row.outcome, 'not_assessed');
});

test('E5: absent:false, marks:0 -> percent:0, a real usable score, never excluded', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: { s1: { absent: false, marks: 0 } } }] });

  const [row] = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(row.percent, 0);
  assert.equal(row.outcome, 'failed');
});

test('E6: maximumMarks is 0 (malformed) -> percent:null, never a divide-by-zero', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 0, results: { s1: { marks: 10 } } }] });

  const [row] = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(row.percent, null);
});

test('E7: two Assessments share the same cycle+subject for this student -> both rows present, flagged duplicateSubjectInCycle', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 40 } } }] });
  addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-02', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 30 } } }] });

  const evidence = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every((row) => row.duplicateSubjectInCycle === true));

  const cycleKey = evidence[0].cycleKey;
  const performance = academicProgressService.getCurrentPerformance(classroom, 's1');
  assert.equal(performance.asOfCycleKey, cycleKey);
  assert.equal(performance.overallPercent, 70, '40+30 / 50+50 = 70%, summed across duplicate rows, never picking one');
});

// =========================================================================
// §4.2 — Cycle resolution
// =========================================================================

test('C1: two Assessments sharing examinationCycleId resolve to the same cycleKey regardless of differing titles', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'Mid Term A', date: '2026-06-01', examinationCycleId: 'cycle-xyz', subjects: [{ subjectId: ENGLISH, results: {} }] });
  const b = addAssessment(classroom, { title: 'Totally Different Title', date: '2026-06-02', examinationCycleId: 'cycle-xyz', subjects: [{ subjectId: MATHS, results: {} }] });

  assert.equal(academicProgressService.resolveCycleKey(a), academicProgressService.resolveCycleKey(b));
  assert.equal(academicProgressService.resolveCycleKey(a), 'cycle-xyz');
});

test('C2: no examinationCycleId, identical title + academicYear -> same cycleKey (fallback path)', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, results: {} }] });
  const b = addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-02', subjects: [{ subjectId: MATHS, results: {} }] });

  assert.equal(academicProgressService.resolveCycleKey(a), academicProgressService.resolveCycleKey(b));
});

test('C3: identical title, different academicYear -> different cycleKeys', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'Quarterly Examinations', academicYear: '2025-26', date: '2025-09-01', subjects: [{ subjectId: ENGLISH, results: {} }] });
  const b = addAssessment(classroom, { title: 'Quarterly Examinations', academicYear: '2026-27', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, results: {} }] });

  assert.notEqual(academicProgressService.resolveCycleKey(a), academicProgressService.resolveCycleKey(b));
});

test('C4: a cycle whose every Assessment is Draft never appears in listExaminationCycles()', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', status: 'Draft', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: {} }] });

  assert.equal(academicProgressService.listExaminationCycles(classroom).length, 0);
});

test('C5: a cycle with one Draft and one Published Assessment is eligible, but only the Published one contributes evidence', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Quarterly Examinations', status: 'Draft', date: '2026-09-01', subjects: [{ subjectId: SCIENCE, results: { s1: { marks: 99 } } }] });
  addAssessment(classroom, { title: 'Quarterly Examinations', status: 'Published', date: '2026-09-02', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 40 } } }] });

  const cycles = academicProgressService.listExaminationCycles(classroom);
  assert.equal(cycles.length, 1);

  const evidence = academicProgressService.getStudentExamEvidence(classroom, 's1');
  assert.equal(evidence.length, 1, 'only the Published AssessmentSubject contributes a row');
  assert.equal(evidence[0].subjectKey, 'english');
});

test('C6: whitespace/case-insensitive title normalization under the fallback path', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'quarterly examinations ', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, results: {} }] });
  const b = addAssessment(classroom, { title: 'Quarterly   Examinations', date: '2026-09-02', subjects: [{ subjectId: MATHS, results: {} }] });

  assert.equal(academicProgressService.resolveCycleKey(a), academicProgressService.resolveCycleKey(b));
});

// =========================================================================
// §4.3 — Current Performance
// =========================================================================

test('P1: zero Published results ever -> currentPerformance is null with reason no_published_results', () => {
  const classroom = buildClassroom();
  const performance = academicProgressService.getCurrentPerformance(classroom, 's1');

  assert.equal(performance.asOfCycleKey, null);
  assert.equal(performance.overallPercent, null);
  assert.deepEqual(performance.bySubject, []);
  assert.equal(performance.reason, 'no_published_results');
});

test('P2: latest cycle has usable marks in 2 of 3 subjects -> all 3 appear, ungraded one is not_assessed, overall sums only the 2 graded', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Quarterly Examinations',
    date: '2026-09-01',
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 40 } } },
      { subjectId: MATHS, maximumMarks: 50, results: { s1: { marks: 30 } } },
      { subjectId: SCIENCE, maximumMarks: 100, results: {} },
    ],
  });

  const performance = academicProgressService.getCurrentPerformance(classroom, 's1');
  assert.equal(performance.bySubject.length, 3);

  const science = performance.bySubject.find((s) => s.subjectKey === 'science');
  assert.equal(science.percent, null);
  assert.equal(science.band, 'not_assessed');

  // 40+30 / 50+50 = 70%
  assert.equal(performance.overallPercent, 70);
});

test('P3: the chronologically latest cycle has zero usable marks anywhere; asOfCycleKey falls back to the earlier, actually-measurable cycle', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 45 } } }] });
  const laterUngraded = addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: {} }] });

  const performance = academicProgressService.getCurrentPerformance(classroom, 's1');
  assert.notEqual(performance.asOfCycleKey, academicProgressService.resolveCycleKey(laterUngraded));
  assert.equal(performance.overallPercent, 90);
});

test('P4: two eligible cycles share the exact same representative date -> deterministic tie-break on the LATER cycleKey string', () => {
  const classroom = buildClassroom();
  // Same academicYear + date; titles chosen so "quarterly" sorts after "mid term" alphabetically in the fallback key.
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 10 } } }] });
  addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 50, results: { s1: { marks: 45 } } }] });

  const performance = academicProgressService.getCurrentPerformance(classroom, 's1');
  assert.equal(performance.overallPercent, 90, 'the Quarterly cycle (lexicographically later cycleKey) must win the tie, not Mid Term');
});

test('P5: subject percent exactly equal to its own passMarkPercent -> band yellow, outcome passed', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Unit Test 1', date: '2026-06-01', passMarkPercent: 40, subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 40 } } }] });

  const performance = academicProgressService.getCurrentPerformance(classroom, 's1');
  const english = performance.bySubject[0];
  assert.equal(english.band, 'yellow');
  assert.equal(english.outcome, 'passed');
});

// =========================================================================
// §4.4 — Growth
// =========================================================================

test('G1: exactly one eligible cycle exists -> growth series is empty', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, results: { s1: { marks: 40 } } }] });

  assert.deepEqual(academicProgressService.getGrowthSeries(classroom, 's1'), []);
});

test('G2: two cycles, overall 55% -> 70%, delta is +15.0 percentage points (never a ratio)', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 55 } } }] });
  addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 70 } } }] });

  const [growth] = academicProgressService.getGrowthSeries(classroom, 's1');
  assert.equal(growth.deltaPercentPoints, 15.0);
  assert.equal(growth.reason, null);
});

test('G3: cycle A usable, cycle B has no usable mark for that subject -> insufficient_data, missingSide "to"', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 55 } } }] });
  addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: {} }] });

  const [growth] = academicProgressService.getGrowthSeries(classroom, 's1');
  assert.equal(growth.deltaPercentPoints, null);
  assert.equal(growth.reason, 'insufficient_data');
  assert.equal(growth.missingSide, 'to');
});

test('G4: a subject present in cycle A is entirely absent from cycle B -> same insufficient_data treatment, reported not silently dropped', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: SCIENCE, maximumMarks: 100, results: { s1: { marks: 60 } } }] });
  addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 70 } } }] });

  const [growth] = academicProgressService.getGrowthSeries(classroom, 's1');
  const scienceGrowth = growth.bySubject.find((g) => g.subjectKey === 'science');
  assert.equal(scienceGrowth.deltaPercentPoints, null);
  assert.equal(scienceGrowth.reason, 'insufficient_data');
  assert.equal(scienceGrowth.missingSide, 'to');
});

test('G5: getGrowthBetweenCycles supports a non-adjacent, explicitly-chosen pair', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 50 } } }] });
  addAssessment(classroom, { title: 'Mid Term 2', date: '2026-07-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 999 } } }] }); // irrelevant middle cycle (bad data on purpose, never touched)
  const c = addAssessment(classroom, { title: 'Final Examinations', date: '2026-12-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 80 } } }] });

  const growth = academicProgressService.getGrowthBetweenCycles(
    classroom,
    's1',
    academicProgressService.resolveCycleKey(a),
    academicProgressService.resolveCycleKey(c)
  );
  assert.equal(growth.deltaPercentPoints, 30.0);
});

// =========================================================================
// §4.5 — Trend
// =========================================================================

function addOverallCycle(classroom, title, date, marks) {
  return addAssessment(classroom, { title, date, subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks } } }] });
}

test('T1: 0 or 1 available cycles -> insufficient_data', () => {
  const classroom = buildClassroom();
  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'insufficient_data');

  addOverallCycle(classroom, 'Mid Term 1', '2026-06-01', 50);
  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'insufficient_data');
});

test('T2: 2 cycles, delta +10pp -> improving', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Mid Term 1', '2026-06-01', 50);
  addOverallCycle(classroom, 'Mid Term 2', '2026-07-01', 60);

  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'improving');
});

test('T3: 2 cycles, delta +1pp -> stable (inside the dead zone)', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Mid Term 1', '2026-06-01', 50);
  addOverallCycle(classroom, 'Mid Term 2', '2026-07-01', 51);

  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'stable');
});

test('T4: 4 cycles, deltas [+1,-5,+1] classify as [flat,down,flat] -> declining', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Cycle 1', '2026-05-01', 60);
  addOverallCycle(classroom, 'Cycle 2', '2026-06-01', 61); // +1 flat
  addOverallCycle(classroom, 'Cycle 3', '2026-07-01', 56); // -5 down
  addOverallCycle(classroom, 'Cycle 4', '2026-08-01', 57); // +1 flat

  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'declining');
});

test('T5: 4 cycles, deltas [+10,-1,-1] classify as [up,flat,flat] -> improving', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Cycle 1', '2026-05-01', 50);
  addOverallCycle(classroom, 'Cycle 2', '2026-06-01', 60); // +10 up
  addOverallCycle(classroom, 'Cycle 3', '2026-07-01', 59); // -1 flat
  addOverallCycle(classroom, 'Cycle 4', '2026-08-01', 58); // -1 flat

  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'improving');
});

test('T6: deltas [+5,-5] (one up, one down) -> stable tie', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Cycle 1', '2026-05-01', 50);
  addOverallCycle(classroom, 'Cycle 2', '2026-06-01', 55); // +5 up
  addOverallCycle(classroom, 'Cycle 3', '2026-07-01', 50); // -5 down

  assert.equal(academicProgressService.getTrend(classroom, 's1').overall, 'stable');
});

test('T7: subject-level trend can differ from overall trend for the same student', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Cycle 1',
    date: '2026-05-01',
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 40 } } },
      { subjectId: MATHS, maximumMarks: 100, results: { s1: { marks: 90 } } },
    ],
  });
  addAssessment(classroom, {
    title: 'Cycle 2',
    date: '2026-07-01',
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 90 } } }, // English climbs hard
      { subjectId: MATHS, maximumMarks: 100, results: { s1: { marks: 40 } } }, // Maths drops hard
    ],
  });

  const trend = academicProgressService.getTrend(classroom, 's1');
  const english = trend.bySubject.find((s) => s.subjectKey === 'english');
  const maths = trend.bySubject.find((s) => s.subjectKey === 'mathematics');
  assert.equal(english.trend, 'improving');
  assert.equal(maths.trend, 'declining');
});

// =========================================================================
// §4.6 — Consistency
// =========================================================================

test('S1: 1 available cycle -> insufficient_data', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Mid Term 1', '2026-06-01', 72);

  const consistency = academicProgressService.getConsistency(classroom, 's1');
  assert.equal(consistency.overall.spreadPercentPoints, null);
  assert.equal(consistency.overall.label, 'insufficient_data');
});

test('S2: identical percent every cycle -> spread 0.0, stable', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Cycle 1', '2026-05-01', 72);
  addOverallCycle(classroom, 'Cycle 2', '2026-06-01', 72);
  addOverallCycle(classroom, 'Cycle 3', '2026-07-01', 72);

  const consistency = academicProgressService.getConsistency(classroom, 's1');
  assert.equal(consistency.overall.spreadPercentPoints, 0);
  assert.equal(consistency.overall.label, 'stable');
});

test('S3: spread exactly 15.0 -> stable (inclusive boundary)', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Cycle 1', '2026-05-01', 50);
  addOverallCycle(classroom, 'Cycle 2', '2026-06-01', 65);

  const consistency = academicProgressService.getConsistency(classroom, 's1');
  assert.equal(consistency.overall.spreadPercentPoints, 15);
  assert.equal(consistency.overall.label, 'stable');
});

test('S4: spread 16.0 -> variable', () => {
  const classroom = buildClassroom();
  addOverallCycle(classroom, 'Cycle 1', '2026-05-01', 50);
  addOverallCycle(classroom, 'Cycle 2', '2026-06-01', 66);

  const consistency = academicProgressService.getConsistency(classroom, 's1');
  assert.equal(consistency.overall.spreadPercentPoints, 16);
  assert.equal(consistency.overall.label, 'variable');
});

// =========================================================================
// §4.7 — Subject bands
// =========================================================================

test('B1: percent exactly 70.0 -> green/strengths', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: GREEN_THRESHOLD_PERCENT } } }] });

  const bands = academicProgressService.getSubjectBands(classroom, 's1');
  assert.equal(bands.strengths.length, 1);
  assert.equal(bands.strengths[0].subjectKey, 'english');
});

test('B2: percent exactly equal to passMarkPercent -> yellow/developing, not needs-improvement', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', passMarkPercent: PASS_MARK_PERCENT, subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: PASS_MARK_PERCENT } } }] });

  const bands = academicProgressService.getSubjectBands(classroom, 's1');
  assert.equal(bands.developing.length, 1);
  assert.equal(bands.areasNeedingImprovement.length, 0);
});

test('B3: percent just below passMarkPercent -> red/needs improvement', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', passMarkPercent: PASS_MARK_PERCENT, subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: PASS_MARK_PERCENT - 1 } } }] });

  const bands = academicProgressService.getSubjectBands(classroom, 's1');
  assert.equal(bands.areasNeedingImprovement.length, 1);
});

test('B4: a not_assessed subject lands in notYetAssessed, never areasNeedingImprovement', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 80 } } },
      { subjectId: SCIENCE, maximumMarks: 100, results: {} },
    ],
  });

  const bands = academicProgressService.getSubjectBands(classroom, 's1');
  assert.equal(bands.notYetAssessed.length, 1);
  assert.equal(bands.notYetAssessed[0].subjectKey, 'science');
  assert.equal(bands.areasNeedingImprovement.length, 0);
});

test('B5: all subjects green -> areasNeedingImprovement is [], not an error', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 95 } } },
      { subjectId: MATHS, maximumMarks: 100, results: { s1: { marks: 90 } } },
    ],
  });

  const bands = academicProgressService.getSubjectBands(classroom, 's1');
  assert.deepEqual(bands.areasNeedingImprovement, []);
  assert.equal(bands.strengths.length, 2);
});

// =========================================================================
// §4.8 — Attention flags
// =========================================================================

function addNotebookWithCheckpoints(classroom, { subjectName = 'English', typeName = 'Classwork', checkpoints }) {
  const subject = createNotebookSubject({ name: subjectName });
  classroom.notebookConfig.subjects.push(subject);
  const type = createNotebookType({ subjectId: subject.id, name: typeName });
  classroom.notebookConfig.notebookTypes.push(type);

  const createdCheckpoints = checkpoints.map((cp) =>
    checkpointService.createNewCheckpoint(classroom, { subjectId: subject.id, notebookTypeId: type.id, title: cp.title, description: '', givenDate: cp.dueDate, dueDate: cp.dueDate })
  );
  return { subject, type, checkpoints: createdCheckpoints };
}

test('A1: a healthy student (all green, stable, no help requests, no overdue checkpoints) has zero attention flags', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 90 } } }],
  });

  assert.deepEqual(academicProgressService.getAttentionFlags(classroom, 's1'), []);
});

test('A2: one subject failed in the latest cycle only -> only failed_subject_latest_cycle fires, scoped to that subject', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    passMarkPercent: 40,
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 20 } } },
      { subjectId: MATHS, maximumMarks: 100, results: { s1: { marks: 90 } } },
    ],
  });

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].flag, 'failed_subject_latest_cycle');
  assert.equal(flags[0].subjectId, 'english');
});

test('A3: a subject never graded this cycle -> not_assessed_latest_cycle fires, distinct from a failed subject', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    subjects: [
      { subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 90 } } },
      { subjectId: SCIENCE, maximumMarks: 100, results: {} },
    ],
  });

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].flag, 'not_assessed_latest_cycle');
  assert.equal(flags[0].subjectId, 'science');
});

test('A4: exactly 1 concept flagged helpRequested -> repeated_help_requests does NOT fire', () => {
  const classroom = buildClassroom();
  classroom.learningRecord.subjects[0].units.push({ id: 'u1', title: 'Unit 1', concepts: [{ id: 'con1', title: 'Concept 1', status: 'taught', resourceLinks: [] }] });
  const student = classroom.teams[0].students[0];
  student.learningRecord.con1 = { understanding: 'need_help', notebook: 'not_required', helpRequested: true, updatedAt: null };

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  assert.ok(!flags.some((f) => f.flag === 'repeated_help_requests'));
});

test('A5: exactly 2 concepts flagged helpRequested -> repeated_help_requests fires', () => {
  const classroom = buildClassroom();
  classroom.learningRecord.subjects[0].units.push({
    id: 'u1',
    title: 'Unit 1',
    concepts: [
      { id: 'con1', title: 'Concept 1', status: 'taught', resourceLinks: [] },
      { id: 'con2', title: 'Concept 2', status: 'taught', resourceLinks: [] },
    ],
  });
  const student = classroom.teams[0].students[0];
  student.learningRecord.con1 = { understanding: 'need_help', notebook: 'not_required', helpRequested: true, updatedAt: null };
  student.learningRecord.con2 = { understanding: 'need_help', notebook: 'not_required', helpRequested: true, updatedAt: null };

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  const flag = flags.find((f) => f.flag === 'repeated_help_requests');
  assert.ok(flag);
  assert.equal(flag.detail.count, 2);
});

test('A6: only 2 past-due checkpoints, both incomplete -> high_incomplete_checkpoint_rate does NOT fire (below the minimum-evidence floor)', () => {
  const classroom = buildClassroom();
  const { subject, type, checkpoints } = addNotebookWithCheckpoints(classroom, {
    checkpoints: [
      { title: 'Unit 1', dueDate: '2020-01-01' },
      { title: 'Unit 2', dueDate: '2020-01-02' },
    ],
  });
  const student = classroom.teams[0].students[0];
  checkpoints.forEach((cp) => {
    checkpointService.setSubmission(cp, student.id, { status: 'submitted', submittedDate: '2020-01-05' });
    checkpointService.setReview(cp, student.id, { status: 'incomplete', reviewedDate: '2020-01-06' });
  });

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  assert.ok(!flags.some((f) => f.flag === 'high_incomplete_checkpoint_rate'));
});

test('A7: 3 past-due checkpoints, 1 incomplete (rate 0.333) -> fires (>= 0.30 inclusive)', () => {
  const classroom = buildClassroom();
  const { checkpoints } = addNotebookWithCheckpoints(classroom, {
    checkpoints: [
      { title: 'Unit 1', dueDate: '2020-01-01' },
      { title: 'Unit 2', dueDate: '2020-01-02' },
      { title: 'Unit 3', dueDate: '2020-01-03' },
    ],
  });
  const student = classroom.teams[0].students[0];
  checkpointService.setSubmission(checkpoints[0], student.id, { status: 'submitted', submittedDate: '2020-01-05' });
  checkpointService.setReview(checkpoints[0], student.id, { status: 'incomplete', reviewedDate: '2020-01-06' });
  checkpointService.setSubmission(checkpoints[1], student.id, { status: 'submitted', submittedDate: '2020-01-05' });
  checkpointService.setReview(checkpoints[1], student.id, { status: 'complete', reviewedDate: '2020-01-06' });
  checkpointService.setSubmission(checkpoints[2], student.id, { status: 'submitted', submittedDate: '2020-01-05' });
  checkpointService.setReview(checkpoints[2], student.id, { status: 'complete', reviewedDate: '2020-01-06' });

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  const flag = flags.find((f) => f.flag === 'high_incomplete_checkpoint_rate');
  assert.ok(flag);
  assert.equal(flag.detail.incompleteCount, 1);
});

test('A8: 3 past-due checkpoints, 0 incomplete, 2 not_submitted (rate 0.667) -> fires via the not_submitted sub-condition', () => {
  const classroom = buildClassroom();
  const { checkpoints } = addNotebookWithCheckpoints(classroom, {
    checkpoints: [
      { title: 'Unit 1', dueDate: '2020-01-01' },
      { title: 'Unit 2', dueDate: '2020-01-02' },
      { title: 'Unit 3', dueDate: '2020-01-03' },
    ],
  });
  const student = classroom.teams[0].students[0];
  checkpointService.setSubmission(checkpoints[0], student.id, { status: 'submitted', submittedDate: '2020-01-05' });
  checkpointService.setReview(checkpoints[0], student.id, { status: 'complete', reviewedDate: '2020-01-06' });
  // checkpoints[1] and [2] left entirely untouched -> not_submitted by default (sparse record)

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  const flag = flags.find((f) => f.flag === 'high_incomplete_checkpoint_rate');
  assert.ok(flag);
  assert.equal(flag.detail.notSubmittedCount, 2);
});

test('A9: a student with zero Published exam evidence at all can still surface only behavior-based flags (never a fabricated exam-based flag)', () => {
  const classroom = buildClassroom();
  classroom.learningRecord.subjects[0].units.push({
    id: 'u1',
    title: 'Unit 1',
    concepts: [
      { id: 'con1', title: 'Concept 1', status: 'taught', resourceLinks: [] },
      { id: 'con2', title: 'Concept 2', status: 'taught', resourceLinks: [] },
    ],
  });
  const student = classroom.teams[0].students[0];
  student.learningRecord.con1 = { understanding: 'need_help', notebook: 'not_required', helpRequested: true, updatedAt: null };
  student.learningRecord.con2 = { understanding: 'need_help', notebook: 'not_required', helpRequested: true, updatedAt: null };

  const flags = academicProgressService.getAttentionFlags(classroom, 's1');
  assert.ok(!flags.some((f) => f.flag === 'failed_subject_latest_cycle' || f.flag === 'not_assessed_latest_cycle' || f.flag.includes('trend')));
  assert.ok(flags.some((f) => f.flag === 'repeated_help_requests'));
});

// =========================================================================
// §4.9 — Class rollups
// =========================================================================

test('R1: a subject with 0 of 2 roster students assessed -> averagePercent null, never a fabricated 0%', () => {
  const classroom = buildClassroom();
  const assessment = addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: {} }] });

  const cycleKey = academicProgressService.resolveCycleKey(assessment);
  const [englishAverage] = academicProgressService.getClassSubjectAverages(classroom, cycleKey);
  assert.equal(englishAverage.averagePercent, null);
  assert.equal(englishAverage.assessedCount, 0);
  assert.equal(englishAverage.totalCount, 2);
});

test('R2: distribution counts always sum to the full roster size', () => {
  const classroom = buildClassroom();
  const assessment = addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 90 } } }], // s2 left ungraded
  });

  const cycleKey = academicProgressService.resolveCycleKey(assessment);
  const distribution = academicProgressService.getClassDistribution(classroom, cycleKey);
  const total = distribution.green + distribution.yellow + distribution.red + distribution.not_assessed;
  assert.equal(total, 2);
  assert.equal(distribution.not_assessed, 1);
});

test('R3: studentsNeedingAttention evaluates cycle-scoped flags against the REQUESTED cycle, even if a later cycle already exists for that student', () => {
  const classroom = buildClassroom();
  const midTerm = addAssessment(classroom, {
    title: 'Mid Term 1',
    date: '2026-06-01',
    passMarkPercent: 40,
    subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 20 }, s2: { marks: 90 } } }],
  });
  addAssessment(classroom, {
    title: 'Quarterly Examinations',
    date: '2026-09-01',
    passMarkPercent: 40,
    subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 95 } } }], // s1 has since recovered
  });

  const midTermCycleKey = academicProgressService.resolveCycleKey(midTerm);
  const needingAttention = academicProgressService.getStudentsNeedingAttention(classroom, midTermCycleKey);
  const s1Entry = needingAttention.find((e) => e.studentId === 's1');
  assert.ok(s1Entry, 's1 failed English specifically in the Mid Term cycle being asked about');
  assert.ok(s1Entry.flags.some((f) => f.flag === 'failed_subject_latest_cycle'));
});

test('R4: classGrowth computes from exactly the students who have usable data on both sides, ignoring the rest', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 50 } } }] });
  const b = addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 70 } } }] });
  // s2 has no marks in either cycle at all.

  const growth = academicProgressService.getClassGrowth(classroom, academicProgressService.resolveCycleKey(a), academicProgressService.resolveCycleKey(b));
  assert.equal(growth.meanDeltaPercentPoints, 20);
  assert.equal(growth.studentCount, 1);
});

test('R5: classGrowth with zero students having usable data on both sides -> null, insufficient_data', () => {
  const classroom = buildClassroom();
  const a = addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: {} }] });
  const b = addAssessment(classroom, { title: 'Quarterly Examinations', date: '2026-09-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: {} }] });

  const growth = academicProgressService.getClassGrowth(classroom, academicProgressService.resolveCycleKey(a), academicProgressService.resolveCycleKey(b));
  assert.equal(growth.meanDeltaPercentPoints, null);
  assert.equal(growth.reason, 'insufficient_data');
  assert.equal(growth.studentCount, 0);
});

// =========================================================================
// Bundled entry points — basic shape/smoke coverage
// =========================================================================

test('getStudentAcademicEvidence bundles all four evidence streams', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 80 } } }] });

  const evidence = academicProgressService.getStudentAcademicEvidence(classroom, 's1');
  assert.ok(Array.isArray(evidence.examRecords));
  assert.ok(Array.isArray(evidence.conceptEvidence));
  assert.ok(Array.isArray(evidence.activityEvidence));
  assert.ok(Array.isArray(evidence.checkpointEvidence));
});

test('getStudentAcademicProgress bundles every derived metric into one object', () => {
  const classroom = buildClassroom();
  addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 80 } } }] });

  const progress = academicProgressService.getStudentAcademicProgress(classroom, 's1');
  assert.equal(progress.studentId, 's1');
  assert.ok(progress.currentPerformance);
  assert.ok(Array.isArray(progress.growthSeries));
  assert.ok(progress.trend);
  assert.ok(progress.consistency);
  assert.ok(progress.subjectBands);
  assert.ok(Array.isArray(progress.attentionFlags));
});

test('getClassAcademicProgressInsights bundles subject averages, distribution, and students needing attention', () => {
  const classroom = buildClassroom();
  const assessment = addAssessment(classroom, { title: 'Mid Term 1', date: '2026-06-01', passMarkPercent: 40, subjects: [{ subjectId: ENGLISH, maximumMarks: 100, results: { s1: { marks: 20 }, s2: { marks: 90 } } }] });

  const insights = academicProgressService.getClassAcademicProgressInsights(classroom, academicProgressService.resolveCycleKey(assessment));
  assert.equal(insights.cycleKey, academicProgressService.resolveCycleKey(assessment));
  assert.ok(Array.isArray(insights.subjectAverages));
  assert.ok(insights.distribution);
  assert.ok(Array.isArray(insights.studentsNeedingAttention));
});
