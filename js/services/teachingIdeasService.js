/**
 * services/teachingIdeasService.js
 *
 * Phase 4 — Teaching Ideas: a derived, read-only-to-normal-users
 * projection of APPROVED LessonPlans (see
 * repositories/teachingIdeasRepository.js's own header comment for why
 * this is a separate, top-level, globally-scoped Firestore collection
 * rather than a subcollection or a reuse of `lessonPlans`), plus the
 * pure extraction that turns one projection document into the typed,
 * independently-reusable elements a teacher can browse and copy from
 * (Sparks / Activities / Questions / Assessment ideas / Differentiation
 * — see extractElements() below).
 *
 * LessonPlan remains the ONE authoritative lesson system — this file
 * never accepts hand-authored input, never gets edited once published
 * (see the firestore.rules block for this collection: `allow update:
 * if false`), and only ever mirrors what an approved LessonPlan already
 * says at the moment of approval. Nothing here is a second place a
 * lesson's real content can diverge from its LessonPlan document.
 *
 * Deliberately Firestore-free, same "stays directly unit-testable"
 * convention services/lessonPlanValidationService.js's own header
 * comment already documents for the identical reason — every function
 * here takes plain data in and returns plain data out. The actual
 * Firestore read/write lives in repositories/teachingIdeasRepository.js;
 * a caller that needs both (e.g. ui/views/LessonPlanReviewView.js
 * publishing right after approve() succeeds, or a discovery view
 * fetching then filtering) imports both and combines them itself —
 * two calls, not one convenience wrapper — so this file never has to
 * import the Firestore SDK transitively and can be exercised by the
 * plain `node --test` suite with no browser/URL-import shim.
 */

import { LESSON_PLAN_STATUS } from '../models/LessonPlan.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

const DIFFERENTIATION_BUCKET_LABELS = Object.freeze({
  redBucket: 'Red Bucket',
  greenBucket: 'Green Bucket',
  others: 'Others',
});

function isBlank(value) {
  return !value || !String(value).trim();
}

/** Only an APPROVED LessonPlan is ever eligible — DRAFT/SUBMITTED/CHANGES_REQUESTED never produce a projection, per explicit Phase 4 product direction. */
export function isTeachingIdeaEligible(lessonPlan) {
  return lessonPlan.status === LESSON_PLAN_STATUS.APPROVED;
}

/**
 * Builds the projection document for one approved LessonPlan — a
 * point-in-time SNAPSHOT of its content, not a live view. `sourceClassroomId`
 * is retained (needed by the firestore.rules `create` check, which
 * verifies the writer is a member of THAT classroom and that the real
 * source document is genuinely approved) but this service's own
 * discovery functions below never surface it, and no UI in this
 * feature renders it — per explicit Phase 4 privacy direction
 * ("Source: Anu · Grade 6 Fractions," never a classroom name).
 * `teacherDisplayName` is likewise a snapshot, denormalized at publish
 * time — the same "store the display name, don't join against a
 * separate profile later" convention `classroom.members[uid]` already
 * uses everywhere else in this app, and the only workable option here
 * regardless: a global viewer has no read access to the source
 * classroom document to resolve a live name from even if this file
 * wanted to.
 */
export function buildTeachingIdeaProjection(classroom, lessonPlan) {
  if (!isTeachingIdeaEligible(lessonPlan)) {
    throw new Error('Only an APPROVED LessonPlan can be published to Teaching Ideas.');
  }
  return {
    sourceLessonPlanId: lessonPlan.id,
    sourceClassroomId: classroom.id,
    conceptIds: lessonPlan.conceptIds,
    gradeLabel: lessonPlan.gradeLabel,
    subjectId: lessonPlan.subjectId,
    topic: lessonPlan.topic,
    teacherDisplayName: classroom.members?.[lessonPlan.createdByUid]?.displayName || 'A teacher',
    lessonObjective: lessonPlan.lessonObjective,
    bigQuestion: lessonPlan.bigQuestion,
    swbatObjectives: lessonPlan.swbatObjectives,
    selfOthersIndia: lessonPlan.selfOthersIndia,
    assessments: lessonPlan.assessments,
    spark: lessonPlan.spark,
    activities: lessonPlan.activities,
    pairExplanation: lessonPlan.pairExplanation,
    finalQuestion: lessonPlan.finalQuestion,
    teacherLookFors: lessonPlan.teacherLookFors,
    publishedAt: getCurrentIsoDate(),
  };
}

// ---------------------------------------------------------------------
// Extraction — one Teaching Idea projection -> its typed, independently
// reusable elements. Pure, dependency-free (no Firestore import), same
// "stays directly unit-testable" convention services/lessonPlanValidationService.js's
// own header comment already documents for the identical reason.
// ---------------------------------------------------------------------

const sourceContextFor = (teachingIdea) => ({
  sourceLessonPlanId: teachingIdea.sourceLessonPlanId,
  topic: teachingIdea.topic,
  teacherDisplayName: teachingIdea.teacherDisplayName,
  gradeLabel: teachingIdea.gradeLabel,
});

function baseElement(teachingIdea, overrides) {
  return {
    sourceLessonPlanId: teachingIdea.sourceLessonPlanId,
    sourceActivityId: null,
    conceptIds: teachingIdea.conceptIds,
    gradeLabel: teachingIdea.gradeLabel,
    subjectId: teachingIdea.subjectId,
    sourceContext: sourceContextFor(teachingIdea),
    ...overrides,
  };
}

/**
 * One Teaching Idea projection -> its flat list of typed elements.
 * Every element inherits the SOURCE LESSON's own `conceptIds` (Phase 4's
 * explicit, deliberately-accepted V1 simplification — no per-activity
 * concept tagging yet; see this function's own callers for the same
 * note). Differentiation is extracted PER BUCKET, independently — a
 * deliberate Phase 4 product decision, never one combined 3-bucket
 * element — so "Green Bucket: represent the comparison visually" can
 * be discovered and copied without its sibling buckets.
 */
export function extractElements(teachingIdea) {
  const elements = [];

  if (!isBlank(teachingIdea.spark?.title) || !isBlank(teachingIdea.spark?.teacherAction) || !isBlank(teachingIdea.spark?.studentAction)) {
    elements.push(
      baseElement(teachingIdea, {
        elementType: 'spark',
        title: teachingIdea.spark.title || 'Untitled Spark',
        content: { title: teachingIdea.spark.title, teacherAction: teachingIdea.spark.teacherAction, studentAction: teachingIdea.spark.studentAction },
      })
    );
  }

  if (!isBlank(teachingIdea.bigQuestion)) {
    elements.push(baseElement(teachingIdea, { elementType: 'question', sourceSectionKey: 'bigQuestion', title: teachingIdea.bigQuestion, content: teachingIdea.bigQuestion }));
  }
  if (!isBlank(teachingIdea.finalQuestion)) {
    elements.push(baseElement(teachingIdea, { elementType: 'question', sourceSectionKey: 'finalQuestion', title: teachingIdea.finalQuestion, content: teachingIdea.finalQuestion }));
  }

  teachingIdea.assessments.forEach((item) => {
    if (isBlank(item.description)) return;
    elements.push(baseElement(teachingIdea, { elementType: 'assessment', title: item.description, content: item.description }));
  });

  teachingIdea.activities.forEach((activity) => {
    if (!isBlank(activity.title) || !isBlank(activity.teacherAction) || !isBlank(activity.studentAction)) {
      elements.push(
        baseElement(teachingIdea, {
          elementType: 'activity',
          sourceActivityId: activity.id,
          title: activity.title || 'Untitled Activity',
          content: { title: activity.title, teacherAction: activity.teacherAction, studentAction: activity.studentAction, differentiation: activity.differentiation },
        })
      );
    }

    if (activity.differentiation) {
      Object.keys(DIFFERENTIATION_BUCKET_LABELS).forEach((bucket) => {
        const text = activity.differentiation[bucket];
        if (isBlank(text)) return;
        elements.push(
          baseElement(teachingIdea, {
            elementType: 'differentiation',
            sourceActivityId: activity.id,
            bucket,
            title: `${DIFFERENTIATION_BUCKET_LABELS[bucket]} — ${activity.title || 'Untitled Activity'}`,
            content: text,
          })
        );
      });
    }
  });

  return elements;
}

function matchesSearchText(text, needle) {
  return String(text ?? '').toLowerCase().includes(needle);
}

function elementMatchesSearch(element, needle) {
  if (matchesSearchText(element.title, needle)) return true;
  if (typeof element.content === 'string') return matchesSearchText(element.content, needle);
  if (element.content && typeof element.content === 'object') {
    return Object.values(element.content).some((value) => typeof value === 'string' && matchesSearchText(value, needle));
  }
  return false;
}

/**
 * Pure filtering over an already-extracted element list — split out
 * from findElementsForConcept() below purely so this stays directly
 * unit-testable without a Firestore round-trip, same reasoning as
 * lessonPlanValidationService.js's own header comment on why pure
 * logic and Firestore access are always kept in separate functions in
 * this app. Same hand-rolled-filter convention already used by
 * ui/views/AssessmentManagementView.js and
 * ui/components/LearningHubPanel.js — no new search/filter component.
 */
export function filterElements(elements, { elementType, gradeLabel, subjectId, searchText } = {}) {
  let result = elements;
  if (elementType) result = result.filter((element) => element.elementType === elementType);
  if (gradeLabel) result = result.filter((element) => element.gradeLabel === gradeLabel);
  if (subjectId) result = result.filter((element) => element.subjectId === subjectId);
  if (searchText && searchText.trim()) {
    const needle = searchText.trim().toLowerCase();
    result = result.filter((element) => elementMatchesSearch(element, needle));
  }
  return result;
}

/** Same pure-filtering split as filterElements() above, for complete Teaching Idea lessons rather than extracted elements. */
export function filterLessonExamples(teachingIdeas, { gradeLabel, subjectId, searchText } = {}) {
  let result = teachingIdeas;
  if (gradeLabel) result = result.filter((idea) => idea.gradeLabel === gradeLabel);
  if (subjectId) result = result.filter((idea) => idea.subjectId === subjectId);
  if (searchText && searchText.trim()) {
    const needle = searchText.trim().toLowerCase();
    result = result.filter((idea) => matchesSearchText(idea.topic, needle) || matchesSearchText(idea.lessonObjective, needle));
  }
  return result;
}

/**
 * Discovery, for a caller that already has the classroom's/concept's
 * fetched Teaching Ideas in hand (see
 * repositories/teachingIdeasRepository.js's getTeachingIdeasForConcept()
 * — always concept-scoped, never an unbounded fetch-everything query):
 * extract every element from each, then filter. A UI caller does
 * `const ideas = await teachingIdeasRepository.getTeachingIdeasForConcept(conceptId); const elements = teachingIdeasService.extractElementsForDiscovery(ideas, filters);`
 * — two small, independently-testable steps, never a single opaque
 * Firestore-touching convenience function (see this file's own header
 * comment on why).
 */
export function extractElementsForDiscovery(teachingIdeas, filters = {}) {
  return filterElements(teachingIdeas.flatMap(extractElements), filters);
}
