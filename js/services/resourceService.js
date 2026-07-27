/**
 * services/resourceService.js
 *
 * Resource CRUD for a Concept (see models/Resource.js,
 * models/LearningConcept.js's `resources` field). Its own file rather
 * than folded into services/learningRecordTeacherService.js — Learning
 * Record and Resources are two systems that both attach to a Concept,
 * not one system that owns the other (see
 * docs/UNIFIED_PLATFORM_ARCHITECTURE.md, and the existing
 * learningRecordTeacherService.js / learningRecordStudentService.js
 * split this mirrors). As more concept-attached systems arrive, each
 * gets its own file the same way; nothing should grow into a single
 * do-everything "concept service."
 *
 * Metadata only — create (with a real name from the start, not a
 * placeholder), rename, delete, reorder, and status
 * (Draft/Published/Archived). Nothing here edits a resource's actual
 * content — Reading's content lives in
 * services/readingContentService.js, following the same "one editor
 * at a time, keyed by resource.type" pattern every future type will
 * repeat.
 *
 * getMostRecentlyEditedResource() is what powers the Dashboard's
 * "Continue Working" shortcut — the single most important thing this
 * file does for actually being found and used, not just built.
 *
 * Same mutate-then-caller-saves convention as every other service in
 * this app: nothing here calls workspaceService.save() itself.
 */

import { createResource } from '../models/Resource.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { getAllConcepts } from './learningRecordService.js';

/** Every resource on a concept, in display order. Never assumes the array exists — an older concept saved before this field existed simply has none yet. */
export function getResources(concept) {
  return concept.resources || [];
}

export function getResourceById(concept, resourceId) {
  return getResources(concept).find((r) => r.id === resourceId) || null;
}

/** Creates a resource with its real name from the start (see ui/views/ConceptWorkspaceView.js's immediate-naming step) — never a placeholder title silently sitting there until someone thinks to rename it. */
export function createResourceOnConcept(concept, { title, type }) {
  if (!concept.resources) concept.resources = [];
  const resource = createResource({ title, type });
  concept.resources.push(resource);
  return resource;
}

export function renameResource(concept, resourceId, newTitle) {
  const resource = getResources(concept).find((r) => r.id === resourceId);
  if (resource) {
    resource.title = newTitle;
    resource.updatedAt = getCurrentIsoDate();
  }
  return resource;
}

/** Draft / Published / Archived — see config/resourceTypeConfig.js's RESOURCE_STATUS_KEYS. */
export function setResourceStatus(concept, resourceId, status) {
  const resource = getResources(concept).find((r) => r.id === resourceId);
  if (resource) {
    resource.status = status;
    resource.updatedAt = getCurrentIsoDate();
  }
  return resource;
}

export function deleteResource(concept, resourceId) {
  if (!concept.resources) return false;
  const before = concept.resources.length;
  concept.resources = concept.resources.filter((r) => r.id !== resourceId);
  return concept.resources.length < before;
}

/** Swaps a resource with the one before it in display order. No-op at the top of the list. Reordering isn't a content edit, so it deliberately does not bump updatedAt — the Dashboard shortcut should surface what a teacher actually wrote or reorganized in meaning, not shuffled in position. */
export function moveResourceUp(concept, resourceId) {
  const resources = getResources(concept);
  const index = resources.findIndex((r) => r.id === resourceId);
  if (index <= 0) return;
  [resources[index - 1], resources[index]] = [resources[index], resources[index - 1]];
}

/** Swaps a resource with the one after it in display order. No-op at the bottom of the list. Same "not a content edit" reasoning as moveResourceUp(). */
export function moveResourceDown(concept, resourceId) {
  const resources = getResources(concept);
  const index = resources.findIndex((r) => r.id === resourceId);
  if (index === -1 || index >= resources.length - 1) return;
  [resources[index], resources[index + 1]] = [resources[index + 1], resources[index]];
}

/**
 * The single most recently edited resource across the *entire*
 * classroom, with its concept/unit/subject context — what the
 * Dashboard's "Continue Working" shortcut needs to say "Pressure
 * Quiz — Pressure, Force and Pressure, Science" and jump straight
 * there. Returns null when nothing has ever been edited, which is the
 * honest starting state for a fresh classroom, not something to fake
 * a placeholder for.
 *
 * Optional `type` filter — Lesson Studio's "Continue Writing" (see
 * ui/views/LessonStudioView.js) wants the most recent *Reading*
 * specifically, since that space is about lessons, not every resource
 * type; the Dashboard's own generic shortcut calls this with no
 * filter, since it means "whatever a teacher touched last," full stop.
 */
export function getMostRecentlyEditedResource(classroom, { type } = {}) {
  let best = null;

  getAllConcepts(classroom).forEach(({ subject, unit, concept }) => {
    getResources(concept).forEach((resource) => {
      if (type && resource.type !== type) return;
      const updatedAt = resource.updatedAt || resource.createdAt;
      if (!best || new Date(updatedAt) > new Date(best.resource.updatedAt || best.resource.createdAt)) {
        best = { resource, concept, unit, subject };
      }
    });
  });

  return best;
}

/**
 * Every resource of one type across the whole classroom, each with
 * its concept/unit/subject context, most-recently-edited first,
 * capped at `limit` — what Lesson Studio's "Recent Lessons" list
 * reads from (filtered to `type: 'reading'`, since that's the only
 * type with real lesson content today).
 */
export function getRecentResourcesByType(classroom, type, limit = 5) {
  const matches = [];

  getAllConcepts(classroom).forEach(({ subject, unit, concept }) => {
    getResources(concept).forEach((resource) => {
      if (resource.type === type) matches.push({ resource, concept, unit, subject });
    });
  });

  matches.sort((a, b) => {
    const aTime = new Date(a.resource.updatedAt || a.resource.createdAt);
    const bTime = new Date(b.resource.updatedAt || b.resource.createdAt);
    return bTime - aTime;
  });

  return matches.slice(0, limit);
}
