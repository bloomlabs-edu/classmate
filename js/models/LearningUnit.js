/**
 * models/LearningUnit.js
 *
 * The middle tier of the Learning Record syllabus tree: Subject ->
 * Unit -> Concept (see models/LearningSubject.js,
 * models/LearningConcept.js). A Unit owns its concepts directly, the
 * same "owns its children as a plain array" pattern Team uses for
 * Student (see models/Team.js).
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningUnit({ id, title, concepts = [] } = {}) {
  return {
    id: id || generateId(),
    title,
    concepts,
  };
}
