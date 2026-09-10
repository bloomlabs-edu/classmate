/**
 * services/learningHubLaunchUrlService.js
 *
 * ClassMate's ONLY knowledge of Learning Hub's own launch mechanism:
 * an entry TYPE + an id, turned into `<host>/?entry=<type>:<id>` —
 * never anything about Learning Hub's internal Mission/Card/Journey/
 * Concept structure. Moved here, unchanged, from
 * ui/views/ConceptWorkspaceView.js (which re-exports
 * buildLearningHubLaunchUrl for every existing caller, so nothing
 * importing it from there needs to change) specifically so this
 * logic — plain string-building, zero DOM, zero Firebase — can be
 * unit-tested directly in plain Node. ConceptWorkspaceView.js's own
 * module graph (via services/resourceRepository.js etc.) pulls in
 * Firebase's real, remote-URL ESM imports
 * (https://www.gstatic.com/firebasejs/...), which only resolve inside
 * a browser — importing that whole view module from a Node test would
 * fail before a single assertion ever ran. This file has no imports
 * at all, so it carries none of that risk.
 */

// PLACEHOLDER — Learning Hub is not deployed anywhere yet (today it
// is a file://-only ZIP with no hosting at all). This host is not a
// real, working deployment target; it exists so the launch mechanism
// itself can be built and tested end-to-end now, ready to point at a
// real host the moment one exists, without any other code changing.
const LEARNING_HUB_HOST_PLACEHOLDER = 'https://learning-hub-b2586.web.app';

/**
 * Builds a Learning Hub launch URL from an experience type + id — the
 * ONLY thing ClassMate knows about Learning Hub's own launch
 * mechanism: an entry TYPE and an id, never anything about Learning
 * Hub's internal Mission/Card/Journey structure. Mirrors the real,
 * now-multiple entry types Learning Hub's own app.js genuinely
 * supports (lesson, element-journey, root-journey, sound-journey,
 * listen-read, concept) — this function doesn't hardcode "mission" as
 * the only shape any more.
 *
 * Backward-compatible: calling this with a single string argument
 * (the old missionId-only call) still builds the exact, unchanged
 * `mission:<id>` URL — nothing already relying on the original,
 * accepted single-argument call breaks.
 */
export function buildLearningHubLaunchUrl(experienceTypeOrMissionId, experienceId) {
  // Old, single-argument call: build the exact, unchanged mission: URL.
  if (experienceId === undefined) {
    return `${LEARNING_HUB_HOST_PLACEHOLDER}/?entry=${encodeURIComponent(`mission:${experienceTypeOrMissionId}`)}`;
  }
  return `${LEARNING_HUB_HOST_PLACEHOLDER}/?entry=${encodeURIComponent(`${experienceTypeOrMissionId}:${experienceId}`)}`;
}

/**
 * Resolves a Concept's own canonical Learning Hub Concept Bucket URL —
 * the ClassMate -> Learning Hub Concept identity bridge (see
 * models/LearningConcept.js's own `learningHubConcept` doc comment).
 * `learningHubConcept.conceptId` is the ONLY source of truth: it is
 * opaque and authoritative, and is never parsed, normalized, or
 * derived from `concept.id` or `concept.title` — this function does
 * nothing but pass it straight through to the existing, unmodified
 * `buildLearningHubLaunchUrl()`/`?entry=concept:<conceptId>` mechanism
 * Learning Hub's own app.js already implements (ENTRY_HANDLERS.concept
 * -> showRepositoryConceptDetail(id)).
 *
 * Returns null — never a malformed URL — when there is no valid
 * mapping (no `learningHubConcept`, or a `conceptId` that isn't a
 * real, non-empty string), so callers can safely branch on truthiness
 * alone rather than re-validating the shape themselves.
 */
export function resolveLearningHubConceptBucketUrl(concept) {
  const conceptId = concept && concept.learningHubConcept && concept.learningHubConcept.conceptId;
  if (typeof conceptId !== 'string' || conceptId.trim() === '') return null;
  return buildLearningHubLaunchUrl('concept', conceptId);
}
