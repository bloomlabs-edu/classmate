/**
 * services/resourceService.js
 *
 * Resource operations for a Concept (see models/Resource.js,
 * models/ConceptResourceLink.js, models/LearningConcept.js's
 * `resourceLinks` field). Its own file rather than folded into
 * services/learningRecordTeacherService.js — Learning Record and
 * Resources are two systems that both attach to a Concept, not one
 * system that owns the other (see
 * docs/UNIFIED_PLATFORM_ARCHITECTURE.md, and the existing
 * learningRecordTeacherService.js / learningRecordStudentService.js
 * split this mirrors).
 *
 * Per the agreed Curriculum / Learning Hub domain split, a Resource no
 * longer lives on its Concept — it's an independent Firestore document
 * (see services/resourceRepository.js), reusable across any number of
 * Concepts. A Concept holds only an ordered list of lightweight
 * ConceptResourceLink references. This is a genuine architectural
 * change, not a cosmetic one: reading, creating, renaming, changing
 * status, and deleting a Resource are now real Firestore operations
 * and this file's functions are `async` accordingly — per explicit
 * product direction, that's the correct reflection of the new
 * persistence model, not something to hide behind a cache or a
 * synchronous facade. Reordering (moveResourceUp/moveResourceDown)
 * stays synchronous, deliberately: it only touches a Concept's own
 * `resourceLinks` array position, part of the classroom document
 * itself, with no Resource document access at all — the same
 * "mutate now, caller saves" convention every other service in this
 * app already uses for classroom-document mutations.
 *
 * Migration is lazy and explicit, not a hidden hook fired on every
 * classroom load: migrateConceptResourceLinksIfNeeded() is a Learning
 * Hub concern that Learning Hub's own code calls (see
 * ui/views/ConceptWorkspaceView.js) at the one point it actually
 * matters — right before a Concept's resources are first read in a
 * session — and only writes anything if that Concept still has the
 * old embedded `resources[]` field. Nothing in
 * services/workspaceService.js or services/classroomService.js needs
 * to know Resources exist at all.
 *
 * getMostRecentlyEditedResource() is what will power the Dashboard's
 * "Continue Working" shortcut once wired up — the single most
 * important thing this file does for actually being found and used,
 * not just built.
 */

import { createResource } from '../models/Resource.js';
import { createConceptResourceLink } from '../models/ConceptResourceLink.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import * as resourceRepository from './resourceRepository.js';
import { getAllConcepts } from './learningRecordService.js';

/**
 * One-time, lazy migration for a single Concept still holding the old
 * embedded `resources[]` shape (full Resource objects, each belonging
 * to exactly one Concept) — converts each into a real Resource
 * document (see services/resourceRepository.js) plus a
 * ConceptResourceLink, then removes the old field. Idempotent and
 * safe to call on every access: a Concept with no `resources` field
 * (already migrated, or created fresh after this change) is a no-op.
 *
 * Mutates `concept` in place (this app's usual "mutate, then caller
 * saves" convention) and returns whether anything changed, so the
 * caller knows whether a classroom save is actually needed —
 * deliberately explicit rather than this function silently deciding
 * to persist the classroom itself, which isn't this file's job.
 */
export async function migrateConceptResourceLinksIfNeeded(classroomId, concept) {
  const legacyResources = concept.resources;
  if (!legacyResources || legacyResources.length === 0) {
    if (concept.resources) delete concept.resources; // an empty legacy array left behind — remove it, nothing to migrate
    return false;
  }

  if (!concept.resourceLinks) concept.resourceLinks = [];

  for (const resource of legacyResources) {
    await resourceRepository.saveResource(classroomId, resource);
    concept.resourceLinks.push(
      createConceptResourceLink({ resourceId: resource.id, resourceType: resource.type, addedAt: resource.createdAt })
    );
  }

  delete concept.resources;
  return true;
}

/** Every ConceptResourceLink on a concept — never assumes the array exists, the same defensive convention getResources() below uses for the resolved Resource list. */
export function getResourceLinks(concept) {
  return concept.resourceLinks || [];
}

/**
 * Every Resource linked from a concept, resolved from Firestore, in
 * link order. A link whose resourceId no longer resolves to a real
 * Resource (the underlying resource was deleted independently — see
 * models/Resource.js's own independent-lifecycle reasoning) is
 * silently skipped here rather than throwing; Phase 2's UI work is
 * where a broken link actually surfaces to a teacher as "Resource
 * unavailable," not this read function.
 */
export async function getResources(classroomId, concept) {
  const links = getResourceLinks(concept);
  if (links.length === 0) return [];

  const allResources = await resourceRepository.getResourcesForClassroom(classroomId);
  const resourceById = new Map(allResources.map((resource) => [resource.id, resource]));

  return links.map((link) => resourceById.get(link.resourceId)).filter(Boolean);
}

/**
 * The student-facing counterpart to getResources() — reuses it
 * directly (never a second link-resolution implementation), then
 * applies the one, conservative audience rule: only 'student' or
 * 'both' is visible. An undefined audience (every resource created
 * before this field existed, and any newly-created resource until a
 * teacher-facing audience control exists) is treated as
 * student-invisible, never assumed visible — per explicit product
 * decision, this is deliberately the strict, "opt-in" direction, not
 * "opt-out."
 */
export async function getStudentVisibleResources(classroomId, concept) {
  const resources = await getResources(classroomId, concept);
  return resources.filter((resource) => resource.audience === 'student' || resource.audience === 'both');
}

export async function getResourceById(classroomId, concept, resourceId) {
  const resources = await getResources(classroomId, concept);
  return resources.find((resource) => resource.id === resourceId) || null;
}

/** Creates a resource with its real name from the start (see ui/views/ConceptWorkspaceView.js's immediate-naming step) — never a placeholder title silently sitting there until someone thinks to rename it. Writes the new Resource document, then links it to this concept. */
export async function createResourceOnConcept(classroomId, concept, { title, type, addedBy = null }) {
  const resource = createResource({ title, type });
  await resourceRepository.saveResource(classroomId, resource);

  if (!concept.resourceLinks) concept.resourceLinks = [];
  concept.resourceLinks.push(createConceptResourceLink({ resourceId: resource.id, resourceType: resource.type, addedBy }));

  return resource;
}

export async function renameResource(classroomId, concept, resourceId, newTitle) {
  const resource = await getResourceById(classroomId, concept, resourceId);
  if (!resource) return null;
  resource.title = newTitle;
  resource.updatedAt = getCurrentIsoDate();
  await resourceRepository.saveResource(classroomId, resource);
  return resource;
}

/** Draft / Published / Archived — see config/resourceTypeConfig.js's RESOURCE_STATUS_KEYS. */
export async function setResourceStatus(classroomId, concept, resourceId, status) {
  const resource = await getResourceById(classroomId, concept, resourceId);
  if (!resource) return null;
  resource.status = status;
  resource.updatedAt = getCurrentIsoDate();
  await resourceRepository.saveResource(classroomId, resource);
  return resource;
}

/**
 * Mirrors setResourceStatus() exactly — same read/mutate/save shape,
 * the same, single persistence path every other Resource mutation
 * already uses. Never affects teacher-facing reads (getResources()
 * always returns every resource regardless of audience); only
 * getStudentVisibleResources() reads this field at all.
 */
export async function setResourceAudience(classroomId, concept, resourceId, audience) {
  const resource = await getResourceById(classroomId, concept, resourceId);
  if (!resource) return null;
  resource.audience = audience;
  resource.updatedAt = getCurrentIsoDate();
  await resourceRepository.saveResource(classroomId, resource);
  return resource;
}

/**
 * Phase 1 deliberately preserves today's exact behavior: this app has
 * no "Unlink" vs "Delete" distinction in its UI yet (that split is
 * Phase 2's own scope — see ui/views/ConceptWorkspaceView.js's
 * existing single "Delete" action), so removing a resource here still
 * means removing both the link *and* the underlying Resource
 * document, exactly as deleting an embedded resource did before this
 * migration. Once Phase 2 adds a real "Unlink" action, that new
 * action should only ever call unlinkResource() below, never this
 * one.
 */
export async function deleteResource(classroomId, concept, resourceId) {
  const removed = unlinkResource(concept, resourceId);
  if (removed) await resourceRepository.deleteResourceDoc(classroomId, resourceId);
  return removed;
}

/**
 * Removes only the link between this concept and a resource — the
 * Resource document itself is untouched and remains fully usable by
 * any other concept linking to it, or independently in the Learning
 * Hub. Synchronous: no Resource document access at all, purely a
 * `concept.resourceLinks` array mutation, the same "mutate now, caller
 * saves" convention as moveResourceUp/moveResourceDown below. Not
 * called from anywhere yet in Phase 1 (see deleteResource() above's
 * own comment) — exposed now so Phase 2's real "Unlink" action has
 * exactly the right function ready to call, rather than being written
 * from scratch then.
 */
export function unlinkResource(concept, resourceId) {
  if (!concept.resourceLinks) return false;
  const before = concept.resourceLinks.length;
  concept.resourceLinks = concept.resourceLinks.filter((link) => link.resourceId !== resourceId);
  return concept.resourceLinks.length < before;
}

/** Swaps a link with the one before it in display order. No-op at the top of the list. Purely a resourceLinks array mutation — no Resource document access, so this stays synchronous. */
export function moveResourceUp(concept, resourceId) {
  const links = getResourceLinks(concept);
  const index = links.findIndex((link) => link.resourceId === resourceId);
  if (index <= 0) return;
  [links[index - 1], links[index]] = [links[index], links[index - 1]];
}

/** Swaps a link with the one after it in display order. No-op at the bottom of the list. */
export function moveResourceDown(concept, resourceId) {
  const links = getResourceLinks(concept);
  const index = links.findIndex((link) => link.resourceId === resourceId);
  if (index === -1 || index >= links.length - 1) return;
  [links[index], links[index + 1]] = [links[index + 1], links[index]];
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
 * Fetches the classroom's whole resource library once, then resolves
 * every concept's links against that single fetched list — not one
 * fetch per concept, since Resources aren't scoped to a concept
 * (see services/resourceRepository.js's getResourcesForClassroom()).
 *
 * Optional `type` filter — a "Continue Writing" shortcut for lessons
 * specifically (Reading being the only type with real editable
 * content today) would want the most recent *Reading* specifically;
 * the Dashboard's own generic shortcut would call this with no
 * filter, since it means "whatever a teacher touched last," full
 * stop.
 */
export async function getMostRecentlyEditedResource(classroomId, classroom, { type } = {}) {
  const allResources = await resourceRepository.getResourcesForClassroom(classroomId);
  const resourceById = new Map(allResources.map((resource) => [resource.id, resource]));

  let best = null;

  getAllConcepts(classroom).forEach(({ subject, unit, concept }) => {
    getResourceLinks(concept).forEach((link) => {
      const resource = resourceById.get(link.resourceId);
      if (!resource) return; // broken link — resource no longer exists, skip
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
 * capped at `limit`.
 */
export async function getRecentResourcesByType(classroomId, classroom, type, limit = 5) {
  const allResources = await resourceRepository.getResourcesForClassroom(classroomId);
  const resourceById = new Map(allResources.map((resource) => [resource.id, resource]));

  const matches = [];

  getAllConcepts(classroom).forEach(({ subject, unit, concept }) => {
    getResourceLinks(concept).forEach((link) => {
      const resource = resourceById.get(link.resourceId);
      if (!resource || resource.type !== type) return;
      matches.push({ resource, concept, unit, subject });
    });
  });

  matches.sort((a, b) => {
    const aTime = new Date(a.resource.updatedAt || a.resource.createdAt);
    const bTime = new Date(b.resource.updatedAt || b.resource.createdAt);
    return bTime - aTime;
  });

  return matches.slice(0, limit);
}
