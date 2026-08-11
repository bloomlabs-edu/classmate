/**
 * services/learningHubCatalogueService.js
 *
 * Reads Learning Hub's own catalogue of real, currently-implemented
 * experiences — a plain, explicit fetch, matching the same
 * "explicit fetch, not a live-synced cache" precedent already
 * established for Resources (see docs/UNIFIED_PLATFORM_ARCHITECTURE.md).
 * ClassMate never stores this catalogue anywhere (no Firestore
 * collection, no persisted cache) and never imports Learning Hub
 * source code at all — this is the one, single boundary-crossing
 * read, matching the "smallest generalized structure" architecture
 * already agreed: { id, title, type, entry } per experience.
 *
 * Returns an empty array (never throws) on any failure — an
 * unreachable/misconfigured catalogue must never crash the teacher's
 * own Resource-creation flow; the picker UI is responsible for
 * showing its own "couldn't load" state when this returns empty.
 */

import { LEARNING_HUB_CATALOGUE_URL, LEARNING_HUB_PACKS_URL } from '../config/learningHubCatalogueConfig.js';

export async function fetchLearningHubCatalogue() {
  try {
    const response = await fetch(LEARNING_HUB_CATALOGUE_URL);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.experiences) ? data.experiences : [];
  } catch (error) {
    console.error('[learningHubCatalogueService] Failed to load the Learning Hub catalogue:', error);
    return [];
  }
}

/**
 * Mirrors fetchLearningHubCatalogue() exactly — same contract (never
 * throws, empty array on failure), same "plain explicit fetch, never
 * a persisted cache" principle already established for the
 * Experience catalogue. ClassMate never stores a Pack's own internal
 * Topics/Experiences anywhere — only whichever single Pack a teacher
 * explicitly references from a Unit (see models/LearningUnit.js's
 * own `learningHubPack` field).
 */
export async function fetchLearningHubPacks() {
  try {
    const response = await fetch(LEARNING_HUB_PACKS_URL);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.packs) ? data.packs : [];
  } catch (error) {
    console.error('[learningHubCatalogueService] Failed to load Learning Hub Packs:', error);
    return [];
  }
}

/** Groups a flat experience list by its own `type` field — for the picker UI's own "Lessons / Root Word Journeys / ..." grouping, never a second data shape. */
export function groupExperiencesByType(experiences) {
  const groups = new Map();
  experiences.forEach((experience) => {
    if (!groups.has(experience.type)) groups.set(experience.type, []);
    groups.get(experience.type).push(experience);
  });
  return groups;
}
