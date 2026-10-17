import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getChapterPlanGuidedStages,
  resolveInitialChapterPlanStageIndex,
  clampChapterPlanStageIndex,
  CHAPTER_PLAN_STAGE_KEYS,
} from '../../js/ui/views/ChapterPlanGuidedStepsDisplay.js';
import { getChapterPlanTemplateConfig } from '../../js/config/chapterPlanTemplateConfig.js';
import { createChapterPlan } from '../../js/models/ChapterPlan.js';

function emptyPlan(overrides = {}) {
  return createChapterPlan({ classroomId: 'classroom-a', teacherUid: 'fellow-1', subjectId: 'science', ...overrides });
}

// ---------------------------------------------------------------------
// Stage list / ordering
// ---------------------------------------------------------------------

test('getChapterPlanGuidedStages: the six-stage sequence for a subject WITH subject-specific fields (Mathematics)', () => {
  const config = getChapterPlanTemplateConfig('mathematics');
  const stages = getChapterPlanGuidedStages(emptyPlan({ subjectId: 'mathematics' }), config);
  assert.deepEqual(
    stages.map((stage) => stage.key),
    [
      CHAPTER_PLAN_STAGE_KEYS.PURPOSE,
      CHAPTER_PLAN_STAGE_KEYS.MEANING,
      CHAPTER_PLAN_STAGE_KEYS.CONCEPTS,
      CHAPTER_PLAN_STAGE_KEYS.MASTERY,
      CHAPTER_PLAN_STAGE_KEYS.METHODS,
      CHAPTER_PLAN_STAGE_KEYS.SUBJECT_SPECIFIC,
    ]
  );
});

test('getChapterPlanGuidedStages: the Subject-Specific stage is OMITTED entirely for a subject with no subject-specific fields (Science)', () => {
  const config = getChapterPlanTemplateConfig('science');
  const stages = getChapterPlanGuidedStages(emptyPlan({ subjectId: 'science' }), config);
  assert.equal(stages.length, 5);
  assert.ok(!stages.some((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.SUBJECT_SPECIFIC));
});

test('getChapterPlanGuidedStages: every stage carries a label and a question prompt', () => {
  const config = getChapterPlanTemplateConfig('english');
  const stages = getChapterPlanGuidedStages(emptyPlan({ subjectId: 'english' }), config);
  stages.forEach((stage) => {
    assert.ok(stage.label);
    assert.ok(stage.question);
  });
});

// ---------------------------------------------------------------------
// isFilled / getSummary — per stage, independent of each other
// ---------------------------------------------------------------------

test('Purpose stage: unfilled on a brand-new plan, filled once whatsWorthLearning has text', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  let stages = getChapterPlanGuidedStages(plan, config);
  const purpose = () => stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.PURPOSE);
  assert.equal(purpose().isFilled(plan), false);

  plan.purpose.whatsWorthLearning = 'Students understand plant classification.';
  stages = getChapterPlanGuidedStages(plan, config);
  assert.equal(purpose().isFilled(plan), true);
  assert.equal(purpose().getSummary(plan), 'Students understand plant classification.');
});

test('Purpose stage: filled by Objectives alone, even if whatsWorthLearning is empty', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan({ purpose: { whatsWorthLearning: '', whyDoesLearningMatter: '', importantConcepts: '', supplementaryResources: '', essentialQuestions: [], objectives: ['Classify five plant types'] } });
  const stages = getChapterPlanGuidedStages(plan, config);
  const purpose = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.PURPOSE);
  assert.equal(purpose.isFilled(plan), true);
  assert.equal(purpose.getSummary(plan), 'Classify five plant types');
});

test('Meaning stage: filled by whyDoesLearningMatter OR supplementaryResources, independent of Purpose/Concepts', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  plan.purpose.supplementaryResources = 'A documentary on pollination.';
  const stages = getChapterPlanGuidedStages(plan, config);
  const meaning = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.MEANING);
  const purpose = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.PURPOSE);
  assert.equal(meaning.isFilled(plan), true);
  assert.equal(purpose.isFilled(plan), false);
});

test('Concepts stage: filled by Essential Questions alone', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  plan.purpose.essentialQuestions = ['Why do plants need sunlight?'];
  const stages = getChapterPlanGuidedStages(plan, config);
  const concepts = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.CONCEPTS);
  assert.equal(concepts.isFilled(plan), true);
});

test('Mastery stage: filled by any one of its four fields', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  plan.mastery.lsrwScope = 'Oral presentation on a plant family.';
  const stages = getChapterPlanGuidedStages(plan, config);
  const mastery = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.MASTERY);
  assert.equal(mastery.isFilled(plan), true);
});

test('Methods stage: filled by a Spark reference even when every narrative field is empty', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan({ sparkRefs: [{ id: 'ref-1', sparkId: 'spark-1', section: 'keyMethods' }] });
  const stages = getChapterPlanGuidedStages(plan, config);
  const methods = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.METHODS);
  assert.equal(methods.isFilled(plan), true);
});

test('Subject-Specific stage: filled only by its own config-listed fields', () => {
  const config = getChapterPlanTemplateConfig('mathematics');
  const plan = emptyPlan({ subjectId: 'mathematics' });
  let stages = getChapterPlanGuidedStages(plan, config);
  let subjectSpecific = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.SUBJECT_SPECIFIC);
  assert.equal(subjectSpecific.isFilled(plan), false);

  plan.subjectSpecific.cpaIdeas = 'Use counters before symbols.';
  stages = getChapterPlanGuidedStages(plan, config);
  subjectSpecific = stages.find((stage) => stage.key === CHAPTER_PLAN_STAGE_KEYS.SUBJECT_SPECIFIC);
  assert.equal(subjectSpecific.isFilled(plan), true);
  assert.equal(subjectSpecific.getSummary(plan), 'Use counters before symbols.');
});

test('getSummary never throws on an all-empty plan and returns an empty string', () => {
  const config = getChapterPlanTemplateConfig('english');
  const plan = emptyPlan({ subjectId: 'english' });
  const stages = getChapterPlanGuidedStages(plan, config);
  stages.forEach((stage) => {
    assert.equal(stage.getSummary(plan), '');
  });
});

// ---------------------------------------------------------------------
// Initial stage resolution — lands on the first not-yet-filled stage,
// never gates on it
// ---------------------------------------------------------------------

test('resolveInitialChapterPlanStageIndex: opens on Purpose (index 0) for a brand-new, fully empty plan', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  const stages = getChapterPlanGuidedStages(plan, config);
  assert.equal(resolveInitialChapterPlanStageIndex(stages, plan), 0);
});

test('resolveInitialChapterPlanStageIndex: skips ahead to the first stage that is still empty', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  plan.purpose.whatsWorthLearning = 'filled';
  plan.purpose.whyDoesLearningMatter = 'filled';
  const stages = getChapterPlanGuidedStages(plan, config);
  assert.equal(resolveInitialChapterPlanStageIndex(stages, plan), 2); // Concepts
});

test('resolveInitialChapterPlanStageIndex: falls back to 0 once every stage already has content', () => {
  const config = getChapterPlanTemplateConfig('science');
  const plan = emptyPlan();
  plan.purpose.whatsWorthLearning = 'a';
  plan.purpose.whyDoesLearningMatter = 'b';
  plan.purpose.importantConcepts = 'c';
  plan.mastery.endOfChapterShowcase = 'd';
  plan.methods.keyMethods = 'e';
  const stages = getChapterPlanGuidedStages(plan, config);
  assert.equal(resolveInitialChapterPlanStageIndex(stages, plan), 0);
});

// ---------------------------------------------------------------------
// Navigation bounds — Next/Back/jump are never gated on fill state;
// this is purely range-safety
// ---------------------------------------------------------------------

test('clampChapterPlanStageIndex: Next past the last stage clamps to the last index, not out of range', () => {
  assert.equal(clampChapterPlanStageIndex(5, 5), 4);
});

test('clampChapterPlanStageIndex: Back past the first stage clamps to 0, never negative', () => {
  assert.equal(clampChapterPlanStageIndex(-1, 5), 0);
});

test('clampChapterPlanStageIndex: an in-range index passes through unchanged, whether or not that stage is filled', () => {
  assert.equal(clampChapterPlanStageIndex(2, 5), 2);
});

test('clampChapterPlanStageIndex: a zero-stage list never throws, returns 0', () => {
  assert.equal(clampChapterPlanStageIndex(3, 0), 0);
});
