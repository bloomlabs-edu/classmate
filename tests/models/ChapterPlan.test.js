import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChapterPlan,
  createChapterPlanReviewRound,
  createChapterPlanComment,
  getChapterPlanResourceLinkIndex,
  findChapterPlanResourceLink,
  CHAPTER_PLAN_STATUS,
  CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION,
} from '../../js/models/ChapterPlan.js';
import { createChapterPlanResourceLink } from '../../js/models/ChapterPlanResourceLink.js';

test('createChapterPlan: defaults every dynamic list/section to a real value, status to draft, never undefined anywhere Firestore would reject it', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1' });

  assert.equal(plan.classroomId, 'c1');
  assert.equal(plan.teacherUid, 'u1');
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.DRAFT);
  assert.equal(plan.reviewerUid, null);
  assert.deepEqual(plan.reviewHistory, []);
  assert.deepEqual(plan.activeComments, []);
  assert.deepEqual(plan.resourceLinks, []);
  assert.deepEqual(plan.conceptIds, []);
  assert.equal(plan.curriculumUnitId, null);
  assert.equal(plan.linkedCurriculumUnitId, null);
  assert.equal(plan.termId, null);
  assert.equal(plan.subjectId, null);
  assert.equal(plan.numberOfLessonsDays, null);
  assert.deepEqual(plan.subjectSpecific, {});
  assert.ok(plan.id);
  assert.ok(plan.createdAt);
  assert.equal(plan.updatedAt, plan.createdAt);
});

test('createChapterPlan: createdByUid defaults to teacherUid when not given separately — no submission "on behalf of" a different uid by omission', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'fellow-1' });
  assert.equal(plan.createdByUid, 'fellow-1');
});

test('createChapterPlan: an explicitly different createdByUid is preserved (still a real, distinct field from teacherUid)', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'fellow-1', createdByUid: 'fellow-1' });
  assert.equal(plan.createdByUid, 'fellow-1');
});

test('createChapterPlan: PURPOSE/MASTERY/METHODS sections default to the templates\' own fields, all present, none undefined', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1' });

  assert.deepEqual(plan.purpose, {
    whatsWorthLearning: '',
    whyDoesLearningMatter: '',
    importantConcepts: '',
    supplementaryResources: '',
    essentialQuestions: [],
    objectives: [],
  });
  assert.deepEqual(plan.mastery, {
    endOfChapterShowcase: '',
    bookBackQuestionTypes: '',
    lsrwScope: '',
    vocabularyAndAnchorCharts: '',
  });
  assert.deepEqual(plan.methods, {
    keyMethods: '',
    simplifiedText: '',
    revisionIdeas: '',
    resources: '',
  });
});

test('createChapterPlan: essential questions and objectives round-trip as plain string arrays', () => {
  const plan = createChapterPlan({
    classroomId: 'c1',
    teacherUid: 'u1',
    purpose: {
      whatsWorthLearning: '',
      whyDoesLearningMatter: '',
      importantConcepts: '',
      supplementaryResources: '',
      essentialQuestions: ['Should all plants belong to one group?'],
      objectives: ['Classify plants by structure'],
    },
  });
  assert.deepEqual(plan.purpose.essentialQuestions, ['Should all plants belong to one group?']);
  assert.deepEqual(plan.purpose.objectives, ['Classify plants by structure']);
});

// ---------------------------------------------------------------------
// Subject-specific fields — only the fields the supplied templates
// actually call for beyond the common structure; never forced onto
// every ChapterPlan regardless of subject.
// ---------------------------------------------------------------------

test('createChapterPlan: subjectSpecific carries only the fields the caller supplies (Mathematics CPA Ideas)', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', subjectId: 'mathematics', subjectSpecific: { cpaIdeas: 'Use base-10 blocks for regrouping.' } });
  assert.deepEqual(plan.subjectSpecific, { cpaIdeas: 'Use base-10 blocks for regrouping.' });
  assert.equal(plan.subjectSpecific.grammarMiniLesson, undefined);
});

test('createChapterPlan: subjectSpecific carries only the fields the caller supplies (Literacy/English Grammar Mini Lesson)', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', subjectId: 'english', subjectSpecific: { grammarMiniLesson: 'Simple past tense.' } });
  assert.deepEqual(plan.subjectSpecific, { grammarMiniLesson: 'Simple past tense.' });
  assert.equal(plan.subjectSpecific.cpaIdeas, undefined);
});

test('createChapterPlan: Science/Social Science plans have no subject-specific fields at all by default — {} never grows an unused key', () => {
  const scienceplan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', subjectId: 'science' });
  const socialScienceplan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', subjectId: 'social_science' });
  assert.deepEqual(scienceplan.subjectSpecific, {});
  assert.deepEqual(socialScienceplan.subjectSpecific, {});
});

// ---------------------------------------------------------------------
// templateVersion
// ---------------------------------------------------------------------

test('createChapterPlan: templateVersion defaults to the current organisational template version', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1' });
  assert.equal(plan.templateVersion, CURRENT_CHAPTER_PLAN_TEMPLATE_VERSION);
});

test('createChapterPlan: an explicit, older templateVersion is preserved, never silently bumped to current', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', templateVersion: 0 });
  assert.equal(plan.templateVersion, 0);
});

// ---------------------------------------------------------------------
// Curriculum identity — the two distinct fields
// ---------------------------------------------------------------------

test('createChapterPlan: curriculumUnitId (classroom-local) and linkedCurriculumUnitId (cross-classroom) are independent fields, both nullable', () => {
  const unlinked = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', curriculumUnitId: 'unit-local-1' });
  assert.equal(unlinked.curriculumUnitId, 'unit-local-1');
  assert.equal(unlinked.linkedCurriculumUnitId, null);

  const linked = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', curriculumUnitId: 'unit-local-1', linkedCurriculumUnitId: 'curriculum-index-unit-17' });
  assert.equal(linked.curriculumUnitId, 'unit-local-1');
  assert.equal(linked.linkedCurriculumUnitId, 'curriculum-index-unit-17');
});

test('two ChapterPlans in different classrooms can share the same linkedCurriculumUnitId while having different classroom-local curriculumUnitId values — this is the cross-Fellow "same chapter" join key', () => {
  const rejeeshPlan = createChapterPlan({ classroomId: 'classroom-a', teacherUid: 'rejeesh', curriculumUnitId: 'unit-in-classroom-a', linkedCurriculumUnitId: 'curriculum-index-unit-17' });
  const anuPlan = createChapterPlan({ classroomId: 'classroom-b', teacherUid: 'anu', curriculumUnitId: 'unit-in-classroom-b', linkedCurriculumUnitId: 'curriculum-index-unit-17' });

  assert.notEqual(rejeeshPlan.curriculumUnitId, anuPlan.curriculumUnitId);
  assert.equal(rejeeshPlan.linkedCurriculumUnitId, anuPlan.linkedCurriculumUnitId);
});

// ---------------------------------------------------------------------
// Status lifecycle enum
// ---------------------------------------------------------------------

test('CHAPTER_PLAN_STATUS is its own, independent enum object — not the same object reference as LESSON_PLAN_STATUS or WEEKLY_PLAN_SUBMISSION_STATUS', async () => {
  const { LESSON_PLAN_STATUS } = await import('../../js/models/LessonPlan.js');
  const { WEEKLY_PLAN_SUBMISSION_STATUS } = await import('../../js/models/WeeklyPlanSubmission.js');
  assert.notEqual(CHAPTER_PLAN_STATUS, LESSON_PLAN_STATUS);
  assert.notEqual(CHAPTER_PLAN_STATUS, WEEKLY_PLAN_SUBMISSION_STATUS);
  assert.deepEqual(Object.keys(CHAPTER_PLAN_STATUS), ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED']);
});

test('createChapterPlan: an explicit non-default status round-trips (e.g. reconstructing an already-submitted plan read back from Firestore)', () => {
  const plan = createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', status: CHAPTER_PLAN_STATUS.SUBMITTED, reviewerUid: 'pm-1' });
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.reviewerUid, 'pm-1');
});

// ---------------------------------------------------------------------
// Review round / comment factories
// ---------------------------------------------------------------------

test('createChapterPlanReviewRound: defaults id/at, preserves status/byUid/comments', () => {
  const round = createChapterPlanReviewRound({ status: CHAPTER_PLAN_STATUS.CHANGES_REQUESTED, byUid: 'pm-1', comments: [] });
  assert.ok(round.id);
  assert.ok(round.at);
  assert.equal(round.status, CHAPTER_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(round.byUid, 'pm-1');
  assert.deepEqual(round.comments, []);
});

test('createChapterPlanComment: defaults resolvedAt/roundNumber to null, preserves sectionKey/text/byUid', () => {
  const comment = createChapterPlanComment({ sectionKey: 'purpose', text: 'Add more essential questions.', byUid: 'pm-1' });
  assert.ok(comment.id);
  assert.ok(comment.createdAt);
  assert.equal(comment.resolvedAt, null);
  assert.equal(comment.roundNumber, null);
  assert.equal(comment.sectionKey, 'purpose');
  assert.equal(comment.text, 'Add more essential questions.');
  assert.equal(comment.byUid, 'pm-1');
});

// ---------------------------------------------------------------------
// Resource links — reference, never duplication
// ---------------------------------------------------------------------

test('createChapterPlan: resourceLinks holds ChapterPlanResourceLink references, never a copy of the Resource\'s own content', () => {
  const link = createChapterPlanResourceLink({ classroomId: 'classroom-b', resourceId: 'resource-1', resourceType: 'external_link', addedBy: 'anu' });
  const plan = createChapterPlan({ classroomId: 'classroom-a', teacherUid: 'rejeesh', resourceLinks: [link] });

  assert.equal(plan.resourceLinks.length, 1);
  assert.equal(plan.resourceLinks[0].classroomId, 'classroom-b');
  assert.equal(plan.resourceLinks[0].resourceId, 'resource-1');
  // Only reference fields — no title/content/audience anywhere on the link.
  assert.equal(plan.resourceLinks[0].title, undefined);
  assert.equal(plan.resourceLinks[0].content, undefined);
});

test('getChapterPlanResourceLinkIndex / findChapterPlanResourceLink: find an existing link by id, or report absence', () => {
  const link = createChapterPlanResourceLink({ classroomId: 'classroom-a', resourceId: 'resource-1' });
  const plan = createChapterPlan({ classroomId: 'classroom-a', teacherUid: 'u1', resourceLinks: [link] });

  assert.equal(getChapterPlanResourceLinkIndex(plan, link.id), 0);
  assert.equal(findChapterPlanResourceLink(plan, link.id), plan.resourceLinks[0]);

  assert.equal(getChapterPlanResourceLinkIndex(plan, 'no-such-link'), -1);
  assert.equal(findChapterPlanResourceLink(plan, 'no-such-link'), null);
});
