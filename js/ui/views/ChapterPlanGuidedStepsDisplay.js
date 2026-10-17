/**
 * ui/views/ChapterPlanGuidedStepsDisplay.js
 *
 * Pure stage logic for ui/views/ChapterPlanEditorView.js's own guided,
 * progressive-disclosure Chapter tab (Purpose → Meaning → Concepts →
 * Mastery → Methods → Subject-Specific), rendered one at a time via the
 * domain-agnostic ui/components/GuidedStepFlow.js. Kept in its own
 * dependency-free file, not inline in ChapterPlanEditorView.js itself —
 * same reason ui/views/ChapterPlanEditorTabDisplay.js exists:
 * ChapterPlanEditorView.js transitively imports Firestore-touching
 * repositories, which crashes under plain `node --test`
 * (ERR_UNSUPPORTED_ESM_URL_SCHEME) — these decisions need to stay
 * directly unit-testable without a DOM.
 *
 * This file decides WHICH stages exist, their question/helper copy, and
 * whether each one already has real content ("filled") — never HOW a
 * stage renders its own fields (that stays in ChapterPlanEditorView.js,
 * since it needs `persist()`/editability closures this file has no
 * business holding) and never whether navigating past an unfilled stage
 * is allowed (it always is — see GuidedStepFlow.js's own header comment;
 * this file has no "required" concept at all, on purpose, so submission
 * validation — services/chapterPlanReviewService.js's own
 * isChapterPlanEditable()/submitChapterPlan(), status-gated only, never
 * field-gated — stays a completely separate concern from stage
 * navigation).
 *
 * The Subject-Specific stage is OMITTED entirely (not shown as a locked
 * or empty step) whenever `config.subjectSpecificFields` is empty —
 * exactly the same condition ui/views/ChapterPlanEditorView.js already
 * used to decide whether to render that section at all, preserved
 * verbatim rather than inventing a new rule.
 */

export const CHAPTER_PLAN_STAGE_KEYS = Object.freeze({
  PURPOSE: 'purpose',
  MEANING: 'meaning',
  CONCEPTS: 'concepts',
  MASTERY: 'mastery',
  METHODS: 'methods',
  SUBJECT_SPECIFIC: 'subjectSpecific',
});

function hasText(value) {
  return Boolean(value && value.trim());
}

function hasAnyListText(values) {
  return Boolean((values || []).some((value) => hasText(value)));
}

function firstNonEmpty(...values) {
  return values.find((value) => hasText(value)) || '';
}

function firstNonEmptyListEntry(values) {
  return (values || []).find((value) => hasText(value)) || '';
}

const BASE_STAGE_BUILDERS = [
  () => ({
    key: CHAPTER_PLAN_STAGE_KEYS.PURPOSE,
    label: 'Purpose',
    question: "What's worth learning?",
    helper: 'The big idea a student should still remember years from now.',
    isFilled: (plan) => hasText(plan.purpose.whatsWorthLearning) || hasAnyListText(plan.purpose.objectives),
    getSummary: (plan) => firstNonEmpty(plan.purpose.whatsWorthLearning, firstNonEmptyListEntry(plan.purpose.objectives)),
  }),
  () => ({
    key: CHAPTER_PLAN_STAGE_KEYS.MEANING,
    label: 'Meaning',
    question: 'Why does this learning matter?',
    helper: 'Connect this chapter to real life, future learning, or why the time is worth it.',
    isFilled: (plan) => hasText(plan.purpose.whyDoesLearningMatter) || hasText(plan.purpose.supplementaryResources),
    getSummary: (plan) => firstNonEmpty(plan.purpose.whyDoesLearningMatter, plan.purpose.supplementaryResources),
  }),
  () => ({
    key: CHAPTER_PLAN_STAGE_KEYS.CONCEPTS,
    label: 'Concepts',
    question: 'What are the important concepts?',
    helper: 'The key ideas and essential questions students should be able to explain.',
    isFilled: (plan) => hasText(plan.purpose.importantConcepts) || hasAnyListText(plan.purpose.essentialQuestions),
    getSummary: (plan) => firstNonEmpty(plan.purpose.importantConcepts, firstNonEmptyListEntry(plan.purpose.essentialQuestions)),
  }),
  () => ({
    key: CHAPTER_PLAN_STAGE_KEYS.MASTERY,
    label: 'Mastery',
    question: 'What would show that students have understood this?',
    helper: '',
    isFilled: (plan) =>
      hasText(plan.mastery.endOfChapterShowcase) ||
      hasText(plan.mastery.bookBackQuestionTypes) ||
      hasText(plan.mastery.lsrwScope) ||
      hasText(plan.mastery.vocabularyAndAnchorCharts),
    getSummary: (plan) =>
      firstNonEmpty(plan.mastery.endOfChapterShowcase, plan.mastery.bookBackQuestionTypes, plan.mastery.lsrwScope, plan.mastery.vocabularyAndAnchorCharts),
  }),
  () => ({
    key: CHAPTER_PLAN_STAGE_KEYS.METHODS,
    label: 'Methods',
    question: 'What methods and approaches will bring this chapter to life?',
    helper: '',
    isFilled: (plan) =>
      hasText(plan.methods.keyMethods) ||
      hasText(plan.methods.simplifiedText) ||
      hasText(plan.methods.revisionIdeas) ||
      hasText(plan.methods.resources) ||
      (plan.sparkRefs || []).length > 0 ||
      (plan.resourceLinks || []).length > 0,
    getSummary: (plan) => firstNonEmpty(plan.methods.keyMethods, plan.methods.revisionIdeas, plan.methods.resources),
  }),
];

/**
 * `config` is a config/chapterPlanTemplateConfig.js's own
 * getChapterPlanTemplateConfig() result — only used here to decide
 * whether the Subject-Specific stage exists at all, and to compute its
 * own isFilled/summary logic (`config.subjectSpecificFields`).
 */
export function getChapterPlanGuidedStages(plan, config) {
  const stages = BASE_STAGE_BUILDERS.map((build) => build());

  if (config.subjectSpecificFields.length > 0) {
    stages.push({
      key: CHAPTER_PLAN_STAGE_KEYS.SUBJECT_SPECIFIC,
      label: config.label,
      question: `What ${config.label} elements apply to this chapter?`,
      helper: '',
      isFilled: (currentPlan) => config.subjectSpecificFields.some((field) => hasText(currentPlan.subjectSpecific[field.key])),
      getSummary: (currentPlan) => firstNonEmpty(...config.subjectSpecificFields.map((field) => currentPlan.subjectSpecific[field.key])),
    });
  }

  return stages;
}

/** The first not-yet-filled stage, or stage 0 if every stage already has content (or there are no stages at all) — never gates anything, purely where the flow opens so a teacher lands on the next thing worth doing rather than always restarting at Purpose. */
export function resolveInitialChapterPlanStageIndex(stages, plan) {
  if (stages.length === 0) return 0;
  const firstUnfilled = stages.findIndex((stage) => !stage.isFilled(plan));
  return firstUnfilled === -1 ? 0 : firstUnfilled;
}

/** Keeps a stage index in range (e.g. after the Subject-Specific stage disappears/reappears across a subject change) — never a validation gate, just bounds-safety. */
export function clampChapterPlanStageIndex(index, stageCount) {
  if (stageCount === 0) return 0;
  return Math.max(0, Math.min(index, stageCount - 1));
}
