/**
 * services/guidancePreferenceService.js
 *
 * Reads and writes a teacher's own users/{uid}.guidanceCompleted map —
 * the same "thin I/O wrapper over firestoreClassroomRepository, never
 * touches Firestore directly" split as
 * accentColorPreferenceService.js/themePreferenceService.js. Keyed by
 * flowId (config/guidanceFlows.js), not one global flag — see that
 * file's own header comment for why per-flow versioning is what lets a
 * future flow version replay without re-showing every other flow a
 * teacher already completed.
 *
 * New users (or any flow never explicitly completed) resolve to an
 * empty map — services/guidanceEngine.js's own isFlowComplete() already
 * treats a missing entry as "not complete," so there is no separate
 * "no preference saved" case to special-case here, same convention as
 * the sibling preference services.
 */

import { firestoreClassroomRepository as repository } from '../repositories/firestoreClassroomRepository.js';

export async function getCompletedMapOnce(uid) {
  if (!uid) return {};
  try {
    const stored = await repository.getGuidanceCompletedOnce(uid);
    return stored || {};
  } catch (error) {
    console.error('[guidancePreferenceService] Failed to load guidance completion state:', error);
    return {};
  }
}

/** Fire-and-forget, like every other save in this app — a failure here should never block the flow from finishing for the teacher who just completed it. */
export function setFlowCompleted(uid, flowId, version) {
  if (!uid) return;
  repository.setGuidanceCompleted(uid, flowId, version).catch((error) => {
    console.error('[guidancePreferenceService] Failed to save guidance completion state:', error);
  });
}
