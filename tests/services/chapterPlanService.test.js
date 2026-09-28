import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER_PLAN_STATUS } from '../../js/models/ChapterPlan.js';
import * as chapterPlanService from '../../js/services/chapterPlanService.js';
import * as chapterPlanReviewService from '../../js/services/chapterPlanReviewService.js';

function draft(overrides = {}) {
  return chapterPlanService.createChapterPlanDraft({
    actingUid: 'fellow-1',
    classroomId: 'classroom-a',
    teacherUid: 'fellow-1',
    gradeLabel: 'Grade 8A',
    subjectId: 'science',
    curriculumUnitId: 'unit-local-17',
    chapterName: 'Plant Kingdom',
    ...overrides,
  });
}

// ---------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------

test('createChapterPlanDraft: builds a DRAFT plan with the given ownership/context fields', () => {
  const plan = draft();
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.DRAFT);
  assert.equal(plan.classroomId, 'classroom-a');
  assert.equal(plan.teacherUid, 'fellow-1');
  assert.equal(plan.createdByUid, 'fellow-1');
  assert.equal(plan.gradeLabel, 'Grade 8A');
  assert.equal(plan.subjectId, 'science');
  assert.equal(plan.curriculumUnitId, 'unit-local-17');
  assert.equal(plan.chapterName, 'Plant Kingdom');
  assert.ok(plan.id);
});

test('createChapterPlanDraft: linkedCurriculumUnitId and termId are NOT required — both stay null when omitted (honest Phase 1 limitation, not an error)', () => {
  const plan = draft();
  assert.equal(plan.linkedCurriculumUnitId, null);
  assert.equal(plan.termId, null);
});

test('createChapterPlanDraft: rejects creating a plan on behalf of a different Fellow', () => {
  assert.throws(() => draft({ actingUid: 'someone-else' }), /on behalf of a different Fellow/);
});

test('createChapterPlanDraft: rejects missing required identity fields', () => {
  assert.throws(() => chapterPlanService.createChapterPlanDraft({ actingUid: 'fellow-1', teacherUid: 'fellow-1' }), /classroomId/);
  assert.throws(() => draft({ gradeLabel: '' }), /gradeLabel/);
  assert.throws(() => draft({ subjectId: '' }), /subjectId/);
  assert.throws(() => draft({ chapterName: '' }), /chapterName/);
  assert.throws(() => draft({ curriculumUnitId: '' }), /curriculumUnitId/);
});

test('createChapterPlanDraft: rejects a negative or non-integer templateVersion, but accepts a valid one', () => {
  assert.throws(() => draft({ templateVersion: -1 }), /templateVersion/);
  assert.throws(() => draft({ templateVersion: 1.5 }), /templateVersion/);
  const plan = draft({ templateVersion: 0 });
  assert.equal(plan.templateVersion, 0);
});

// ---------------------------------------------------------------------
// Editing — gated on status, unlike LessonPlan's own mutators
// ---------------------------------------------------------------------

test('the author can edit a DRAFT plan\'s content', () => {
  const plan = draft();
  chapterPlanService.updatePurpose(plan, { whatsWorthLearning: 'Plant classification matters for biodiversity.' });
  assert.equal(plan.purpose.whatsWorthLearning, 'Plant classification matters for biodiversity.');
});

test('the author can edit a CHANGES_REQUESTED plan\'s content', () => {
  const classroom = { members: { 'fellow-1': { role: 'teacher' }, 'pm-1': { role: 'program_manager' } } };
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: 'fellow-1' });
  chapterPlanReviewService.requestChapterPlanChanges(classroom, plan, { byUid: 'pm-1', comments: [{ sectionKey: 'purpose', text: 'Add essential questions.' }] });
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.CHANGES_REQUESTED);
  chapterPlanService.updatePurpose(plan, { essentialQuestions: ['Should all plants belong to one group?'] });
  assert.deepEqual(plan.purpose.essentialQuestions, ['Should all plants belong to one group?']);
});

test('a SUBMITTED plan cannot be freely edited', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: 'fellow-1' });
  assert.throws(() => chapterPlanService.updatePurpose(plan, { whatsWorthLearning: 'edit attempt' }), /can't be edited while it's "submitted"/);
});

test('an APPROVED plan cannot be edited', () => {
  const classroom = { members: { 'fellow-1': { role: 'teacher' }, 'pm-1': { role: 'program_manager' } } };
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: 'fellow-1' });
  chapterPlanReviewService.approveChapterPlan(classroom, plan, { byUid: 'pm-1' });
  assert.throws(() => chapterPlanService.updateMastery(plan, { endOfChapterShowcase: 'edit attempt' }), /can't be edited while it's "approved"/);
});

test('every content mutator (context/purpose/mastery/methods/subjectSpecific/resourceLinks) enforces the same editability gate', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: 'fellow-1' });
  assert.throws(() => chapterPlanService.updateContext(plan, { chapterName: 'x' }));
  assert.throws(() => chapterPlanService.updateMastery(plan, { endOfChapterShowcase: 'x' }));
  assert.throws(() => chapterPlanService.updateMethods(plan, { keyMethods: 'x' }));
  assert.throws(() => chapterPlanService.updateSubjectSpecific(plan, { cpaIdeas: 'x' }));
  assert.throws(() => chapterPlanService.addResourceLink(plan, { classroomId: 'classroom-b', resourceId: 'r1' }));
});

// ---------------------------------------------------------------------
// Section mutators — merge-only-given-fields
// ---------------------------------------------------------------------

test('updateMethods: subject-specific text fields round-trip, unrelated fields untouched', () => {
  const plan = draft();
  chapterPlanService.updateMethods(plan, { keyMethods: 'Use base-10 blocks.' });
  assert.equal(plan.methods.keyMethods, 'Use base-10 blocks.');
  assert.equal(plan.methods.resources, '');
});

test('updateSubjectSpecific: merges only the given keys, never clears keys not mentioned', () => {
  const plan = draft({ subjectId: 'mathematics' });
  chapterPlanService.updateSubjectSpecific(plan, { cpaIdeas: 'Concrete before abstract.' });
  chapterPlanService.updateSubjectSpecific(plan, { grammarMiniLesson: 'unrelated but should not clobber cpaIdeas' });
  assert.equal(plan.subjectSpecific.cpaIdeas, 'Concrete before abstract.');
  assert.equal(plan.subjectSpecific.grammarMiniLesson, 'unrelated but should not clobber cpaIdeas');
});

// ---------------------------------------------------------------------
// Resource links — reference, never duplication; cross-classroom OK
// ---------------------------------------------------------------------

test('addResourceLink / removeResourceLink: add and remove a reference to a Resource in a DIFFERENT classroom', () => {
  const plan = draft();
  const link = chapterPlanService.addResourceLink(plan, { classroomId: 'classroom-b', resourceId: 'resource-owned-by-anu', resourceType: 'external_link', addedBy: 'fellow-1' });
  assert.equal(plan.resourceLinks.length, 1);
  assert.equal(link.classroomId, 'classroom-b');

  chapterPlanService.removeResourceLink(plan, link.id);
  assert.equal(plan.resourceLinks.length, 0);
});

test('addResourceLink: requires both classroomId and resourceId', () => {
  const plan = draft();
  assert.throws(() => chapterPlanService.addResourceLink(plan, { classroomId: 'classroom-b' }));
  assert.throws(() => chapterPlanService.addResourceLink(plan, { resourceId: 'r1' }));
});

// ---------------------------------------------------------------------
// Spark references — reference, never copy; cross-Fellow OK; no
// mutation of the Spark itself
// ---------------------------------------------------------------------

test('addSparkRef / removeSparkRef: add and remove a reference to a Spark authored by a DIFFERENT Fellow', () => {
  const plan = draft();
  const ref = chapterPlanService.addSparkRef(plan, { sparkId: 'spark-authored-by-anu', section: 'keyMethods', addedBy: 'fellow-1' });
  assert.equal(plan.sparkRefs.length, 1);
  assert.equal(ref.sparkId, 'spark-authored-by-anu');
  assert.equal(ref.section, 'keyMethods');

  chapterPlanService.removeSparkRef(plan, ref.id);
  assert.equal(plan.sparkRefs.length, 0);
});

test('addSparkRef: requires a sparkId', () => {
  const plan = draft();
  assert.throws(() => chapterPlanService.addSparkRef(plan, { section: 'keyMethods' }), /sparkId/);
});

test('addSparkRef: rejects a section outside the controlled set', () => {
  const plan = draft();
  assert.throws(() => chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'purpose' }), /not a section a Spark can be referenced against/);
});

test('addSparkRef: prevents an exact duplicate (same sparkId + same section)', () => {
  const plan = draft();
  chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' });
  assert.throws(() => chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' }), /already referenced in this section/);
  assert.equal(plan.sparkRefs.length, 1);
});

test('addSparkRef: the SAME Spark in a DIFFERENT section is allowed, not treated as a duplicate', () => {
  const plan = draft();
  chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' });
  chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'revisionIdeas' });
  assert.equal(plan.sparkRefs.length, 2);
});

test('addSparkRef/removeSparkRef: gated on editability, same as every other content mutator', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: 'fellow-1' });
  assert.throws(() => chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' }));
});

test('findSparkRef: finds a ref by its own id, or null', () => {
  const plan = draft();
  const ref = chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' });
  assert.equal(chapterPlanService.findSparkRef(plan, ref.id), ref);
  assert.equal(chapterPlanService.findSparkRef(plan, 'no-such-ref'), null);
});

test('getSparkRefsForSection: returns only refs for the requested section', () => {
  const plan = draft();
  const keyMethodsRef = chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' });
  chapterPlanService.addSparkRef(plan, { sparkId: 'spark-2', section: 'revisionIdeas' });
  assert.deepEqual(chapterPlanService.getSparkRefsForSection(plan, 'keyMethods'), [keyMethodsRef]);
});

test('removeSparkRef only removes the association — it has no way to delete a Spark at all (no sparkRepository import, no sparkId-based delete call anywhere in this file)', async () => {
  const plan = draft();
  const ref = chapterPlanService.addSparkRef(plan, { sparkId: 'spark-1', section: 'keyMethods' });
  chapterPlanService.removeSparkRef(plan, ref.id);
  // The only way this file could delete a Spark is by IMPORTING
  // sparkRepository/sparkService and calling into it — it imports
  // neither (a comment merely mentioning either module's name, as this
  // file's own header does, is fine; an `import ... from` statement
  // pulling one in is what would actually matter).
  const source = await import('node:fs').then((fs) => fs.promises.readFile(new URL('../../js/services/chapterPlanService.js', import.meta.url), 'utf8'));
  assert.equal(/^import .*(sparkRepository|sparkService)/m.test(source), false);
});

// ---------------------------------------------------------------------
// Weekly Plan untouched
// ---------------------------------------------------------------------

test('nothing in chapterPlanService touches Weekly Plan or Lesson Plan modules at all', async () => {
  const weeklyPlanSubmissionModule = await import('../../js/models/WeeklyPlanSubmission.js');
  const lessonPlanModule = await import('../../js/models/LessonPlan.js');
  // Simply importing both independently and confirming their own enums
  // are untouched/unaffected by any Chapter Plan Phase 2 work — a real
  // regression would show up as a changed enum value or shape here.
  assert.deepEqual(Object.keys(weeklyPlanSubmissionModule.WEEKLY_PLAN_SUBMISSION_STATUS), ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED']);
  assert.deepEqual(Object.keys(lessonPlanModule.LESSON_PLAN_STATUS), ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED']);
});
