/**
 * models/LearningConcept.js
 *
 * The leaf of the syllabus tree: Subject -> Unit -> Concept (see
 * models/LearningSubject.js, models/LearningUnit.js). Named
 * "LearningConcept" rather than the bare "Concept" purely to avoid
 * colliding with the unrelated `NotebookSubject` model's naming
 * space (see that file's own doc comment) — not, as an earlier
 * version of this comment said, to keep this module separate from
 * the rest of the platform. That has changed: per the unified
 * platform architecture (see docs/UNIFIED_PLATFORM_ARCHITECTURE.md),
 * the Concept is now deliberately the one shared join point every
 * concept-attached system hangs off — Learning Record, Resources
 * (see below), and everything Resources will eventually host
 * (worksheets, quizzes, simulations, the future AI tutor). Nothing
 * should bypass the Concept to build a parallel tree of its own.
 *
 * Fields:
 *   status        - whether this concept has been taught to the class
 *                    yet (see config/learningRecordConfig.js's
 *                    CONCEPT_STATUS_KEYS). Deliberately does NOT hold
 *                    understanding/notebook/helpRequested — those vary
 *                    per student, so they live in each Student's own
 *                    `learningRecord` map, keyed by this concept's id
 *                    (see models/StudentConceptRecord.js). Same "shared
 *                    entity once, separate per-student record for
 *                    anything individual" split this app already uses
 *                    for Learning Activities
 *                    (models/LearningActivity.js + Student.submissions).
 *   resourceLinks - ConceptResourceLink[] (see
 *                    models/ConceptResourceLink.js), not Resources
 *                    themselves — per the agreed Learning Hub /
 *                    Curriculum domain split (Curriculum answers "what
 *                    should be taught," Learning Hub answers "how" —
 *                    see docs/UNIFIED_PLATFORM_ARCHITECTURE.md), a
 *                    Concept never contains resource content, only a
 *                    lightweight, ordered list of references to
 *                    Resources that live independently (see
 *                    models/Resource.js, services/resourceRepository.js).
 *                    Order is array position, the same convention
 *                    LearningUnit.concepts and LearningSubject.units
 *                    already use — no separate index field to keep in
 *                    sync. Deleting a Concept deletes its links, never
 *                    the Resources they reference — those are only
 *                    ever removed through their own, independent
 *                    lifecycle. A concept created before this field
 *                    existed (formerly `resources`, holding embedded
 *                    Resource objects directly) is migrated forward by
 *                    services/learningRecordMigrationService.js;
 *                    every reader goes through
 *                    services/resourceService.js's getResources(),
 *                    which defaults a missing array to `[]` rather
 *                    than assuming every concept already has one.
 *   description   - Phase 5 (Student Learning View) addition. A short,
 *                    optional, teacher-authored plain-text blurb — "A
 *                    force is a push or pull..." — answering "what did
 *                    we learn?" for this one concept. Nullable by
 *                    design: a concept created before this field
 *                    existed, or one a teacher simply hasn't written a
 *                    blurb for yet, has `description: null`, and every
 *                    reader treats that as "no preview text to show,"
 *                    never a placeholder/fake description. Set via
 *                    services/learningRecordTeacherService.js's
 *                    setConceptDescription() — the same
 *                    mutate-here-save-at-the-call-site convention
 *                    setConceptTaughtStatus() already uses. Deliberately
 *                    plain text, not the Reading domain's `{blocks:[...]}`
 *                    shape (models/ReadingContent.js) — this is a one-
 *                    line recall aid shown inline next to a feedback
 *                    prompt, not an authored lesson document; a
 *                    concept that genuinely needs a fuller reference
 *                    already has that path via resourceLinks (e.g. an
 *                    'external_link' or 'reading' Resource).
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningConcept({ id, title, status = 'not_taught', resourceLinks = [], description = null } = {}) {
  return {
    id: id || generateId(),
    title,
    status,
    resourceLinks,
    description,
  };
}
