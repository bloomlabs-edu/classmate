/**
 * services/assignmentConfigService.js
 *
 * Manages a classroom's Assignment Categories (see
 * models/Classroom.js's `assignmentConfig`) — directly mirrors
 * services/notebookConfigService.js's own Subject functions, flattened
 * to one level (see models/AssignmentCategory.js's own header comment
 * for why Assignments doesn't need Notebook's Subject+Type pair). A
 * teacher adds/renames/removes categories from Settings > Assignment
 * Categories, same as Notebook Subjects/Types — never hardcoded.
 */

import { createAssignmentCategory, createAssignmentAspect } from '../models/AssignmentCategory.js';

export function listCategories(classroom) {
  return classroom.assignmentConfig.categories;
}

export function addCategory(classroom, name) {
  const category = createAssignmentCategory({ name });
  classroom.assignmentConfig.categories.push(category);
  return category;
}

export function renameCategory(classroom, categoryId, newName) {
  const category = getCategoryById(classroom, categoryId);
  if (category) category.name = newName;
  return category;
}

export function removeCategory(classroom, categoryId) {
  classroom.assignmentConfig.categories = classroom.assignmentConfig.categories.filter((c) => c.id !== categoryId);
}

export function getCategoryById(classroom, categoryId) {
  return classroom.assignmentConfig.categories.find((c) => c.id === categoryId) || null;
}

export function listAspects(category) {
  return category.aspects || [];
}

export function addAspect(category, name) {
  const aspect = createAssignmentAspect({ name });
  if (!category.aspects) category.aspects = [];
  category.aspects.push(aspect);
  return aspect;
}

export function renameAspect(category, aspectId, newName) {
  const aspect = (category.aspects || []).find((a) => a.id === aspectId);
  if (aspect) aspect.name = newName;
  return aspect;
}

/**
 * Removes an aspect from a category's own taxonomy. Deliberately does
 * NOT strip that aspect's own ratings out of already-recorded
 * StudentAssignmentRecords across this category's Assignments — exactly
 * the same "renaming/removing taxonomy never destroys already-entered
 * records" principle notebookConfigService.js's own removeSubject()
 * establishes for checkpoints at the Notebook Type level, just scoped
 * here to one aspect's own ratings key. A stale `ratings[aspectId]`
 * entry for a since-removed aspect is simply never displayed again
 * (the UI only ever renders ratings for the category's CURRENT
 * aspects) — inert, not deleted, consistent with this app's
 * established "never destroy a record a teacher already entered"
 * convention.
 */
export function removeAspect(category, aspectId) {
  category.aspects = (category.aspects || []).filter((a) => a.id !== aspectId);
}

export function getAspectById(category, aspectId) {
  return (category.aspects || []).find((a) => a.id === aspectId) || null;
}
