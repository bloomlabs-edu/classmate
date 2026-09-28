/**
 * config/chapterPlanTemplateConfig.js
 *
 * The single source of truth for which fields the Chapter Plan Editor
 * (ui/views/ChapterPlanEditorView.js) shows for a given subject — per
 * explicit product direction, "do not hard-code subject branching
 * throughout the editor." The editor imports ONLY this file's own
 * getChapterPlanTemplateConfig() to decide what to render; it never
 * itself contains an `if (subjectId === 'mathematics')`-style branch.
 *
 * Maps the four EXISTING canonical subject ids (see
 * config/canonicalSubjectsConfig.js — 'science', 'mathematics',
 * 'english', 'social_science') onto the Phase 1 ChapterPlan model's own
 * `subjectSpecific` shape (see models/ChapterPlan.js's own header
 * comment) — this file invents no new subjectId values and no new
 * ChapterPlan fields, only describes which of the fields Phase 1
 * already defined apply to which subject, and how to label/hint them.
 *
 * PURPOSE/MASTERY's own fields are identical for every subject — the
 * "common structure remains shared" requirement — so this config has
 * nothing to say about them at all. The only two things that vary by
 * subject are:
 *
 *   1. `subjectSpecificFields` — which key(s) of `chapterPlan.subjectSpecific`
 *      this subject actually uses (`cpaIdeas` for Mathematics,
 *      `grammarMiniLesson` for English/Literacy, none for Science/Social
 *      Science — matching the supplied templates' own stated
 *      differences exactly, no additional fields invented beyond them).
 *   2. `showSimplifiedText` — whether `methods.simplifiedText`
 *      ("Simplified Text where applicable") is a field this subject's
 *      template actually calls for. Per the four supplied templates,
 *      only Literacy/English lists a "Simplified version of the text"
 *      line at all; the field itself already exists on every
 *      ChapterPlan (see models/ChapterPlan.js — it's part of the common
 *      `methods` shape, not `subjectSpecific`, since nothing about its
 *      shape is subject-specific, only its relevance), so this is a
 *      display toggle, never a second data field.
 *
 * `placeholderHints` — the templates' own subject-flavored guidance text
 * for the two fields whose narrative CONTENT differs by subject without
 * their STRUCTURE differing at all (`purpose.supplementaryResources`,
 * `methods.resources` — see models/ChapterPlan.js's own header comment
 * on why these stay one shared free-text field, never split into
 * per-subject fields). Purely a placeholder string shown in an empty
 * input, per the original templates' own subject-specific descriptions
 * ("Resources may include worksheets / experiment GO's" for Science,
 * etc.) — never a stored value, never a validation rule.
 */

export const CHAPTER_PLAN_SUBJECT_TEMPLATES = Object.freeze({
  science: Object.freeze({
    subjectId: 'science',
    label: 'Science',
    subjectSpecificFields: Object.freeze([]),
    showSimplifiedText: false,
    placeholderHints: Object.freeze({
      supplementaryResources: 'Additional texts, activities, videos…',
      resources: 'Worksheets, experiment GOs…',
    }),
  }),
  mathematics: Object.freeze({
    subjectId: 'mathematics',
    label: 'Mathematics',
    subjectSpecificFields: Object.freeze([
      Object.freeze({ key: 'cpaIdeas', label: 'CPA Ideas', placeholder: 'Ideas to enable Concrete-Pictorial-Abstract practice toward conceptual clarity…' }),
    ]),
    showSimplifiedText: false,
    placeholderHints: Object.freeze({
      supplementaryResources: 'Additional texts, activities, videos…',
      resources: 'Differentiated worksheets for practice…',
    }),
  }),
  english: Object.freeze({
    subjectId: 'english',
    label: 'Literacy / English',
    subjectSpecificFields: Object.freeze([
      Object.freeze({ key: 'grammarMiniLesson', label: 'Grammar Mini Lesson', placeholder: 'The grammar mini lesson for this chapter…' }),
    ]),
    showSimplifiedText: true,
    placeholderHints: Object.freeze({
      supplementaryResources: 'Additional texts, activities, videos…',
      resources: 'Worksheets…',
    }),
  }),
  social_science: Object.freeze({
    subjectId: 'social_science',
    label: 'Social Science',
    subjectSpecificFields: Object.freeze([]),
    showSimplifiedText: false,
    placeholderHints: Object.freeze({
      supplementaryResources: 'Additional texts, activities, case studies…',
      resources: 'Worksheets, GOs…',
    }),
  }),
});

/**
 * The generic fallback for any subjectId not in the four templates
 * above (e.g. Hindi, Tamil, Computer Science, Art, or a custom
 * teacher-typed subject — see config/canonicalSubjectsConfig.js's own
 * header comment on custom subjects getting their own id) — the common
 * PURPOSE/MASTERY/METHODS structure with no subject-specific fields at
 * all and no Simplified Text, exactly like Science/Social Science.
 * Never throws for an unrecognized subject; a Chapter Plan for any real
 * classroom subject is always renderable.
 */
const DEFAULT_TEMPLATE = Object.freeze({
  subjectId: null,
  label: 'This subject',
  subjectSpecificFields: Object.freeze([]),
  showSimplifiedText: false,
  placeholderHints: Object.freeze({
    supplementaryResources: 'Additional texts, activities, resources…',
    resources: 'Worksheets, activity materials…',
  }),
});

/** The one function the Editor actually calls — never a direct read of CHAPTER_PLAN_SUBJECT_TEMPLATES, so an unrecognized subjectId is handled once, here, not at every call site. */
export function getChapterPlanTemplateConfig(subjectId) {
  return CHAPTER_PLAN_SUBJECT_TEMPLATES[subjectId] || DEFAULT_TEMPLATE;
}
