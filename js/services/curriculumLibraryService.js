/**
 * services/curriculumLibraryService.js
 *
 * The global Curriculum Library — exists independently of schools and
 * classrooms. Schools and teachers don't own curricula; they browse,
 * install, and assign them (see ui/views/CurriculumManagementView.js's
 * Browse Curriculum Library / Curriculum Details / Assign to Class
 * screens, and the one-time ui/views/AssignCurriculumPromptView.js for
 * classrooms created before Curriculum became a required field).
 *
 * Curriculum Library Data Integrity milestone: this file no longer
 * reads from a static, hardcoded manifest. Every curriculum returned
 * by getLibrary() is assembled live from actually-published
 * submissions — see services/curriculumSubmissionsService.js, which
 * is the one real source of truth for what's browsable. An empty
 * install genuinely has an empty Library; nothing here fabricates
 * sample data to fill it. Data model:
 *
 *   Published Submissions (one Grade + Subject each)
 *     -> grouped by curriculum name + version label into:
 *   CurriculumLibrary
 *     Official | Community           (decided per-submission at publish time)
 *       -> Curriculum                (permanent curriculumId, e.g. "samacheer-kalvi")
 *            -> Version              (permanent versionId, e.g. "samacheer-kalvi-2026")
 *                 -> Grade -> Subject -> Unit -> Concept
 *
 * Both IDs are permanent by design — see this project's own
 * architecture notes on why: a school references a specific
 * *version*, not just a curriculum name, so it can stay on the
 * edition it started the academic year with even after a newer
 * version is published (see getAssignedPackForSubject() and
 * models/Classroom.js's curriculumAssignment field, which stores only
 * `{ curriculumId, versionId }` — never a copy of the curriculum's
 * actual data).
 *
 * Consumed by:
 *   - ui/views/CurriculumManagementView.js's Browse/Details/Assign/
 *     Review Submissions screens, and its Contribute Curriculum flow,
 *     which submits new curricula via
 *     services/curriculumSubmissionsService.js rather than writing
 *     here directly — nothing is added to the Library until an admin
 *     explicitly publishes it.
 *   - ui/views/LearningManagementView.js, which never asks a teacher
 *     to pick a curriculum — it reads the classroom's
 *     curriculumAssignment and loads the matching version
 *     automatically via getAssignedPackForSubject().
 *   - ui/views/AddConceptsView.js (Manage Lessons' bulk import), a
 *     separate multi-select import path via
 *     services/conceptImportService.js's generic pipeline.
 *   - ui/components/CurriculumExplorerPanel.js, the one shared
 *     Unit/Concept accordion both Learning Management's Explorer and
 *     Curriculum Management's Preview Structure render with — see
 *     that file's own doc comment for why there is exactly one
 *     explorer, not two.
 */

import * as learningRecordTeacherService from './learningRecordTeacherService.js';
import * as curriculumSubmissionsService from './curriculumSubmissionsService.js';
import { slugify } from './curriculumPackBuilderService.js';

/**
 * Groups every published submission into the Official/Community ->
 * Curriculum -> Version -> Grade -> Subject tree — see this file's
 * own header comment. A curriculum's identity is its (slugified) name;
 * a version's identity is that curriculum plus its (slugified) version
 * label. Two submissions sharing both simply add another Grade/Subject
 * into the same version rather than creating a duplicate — this is how
 * contributing a curriculum one subject at a time still ends up as one
 * coherent, assignable Version.
 */
function buildLibraryFromPublishedSubmissions() {
  const curriculaById = new Map();

  for (const submission of curriculumSubmissionsService.getPublishedSubmissions()) {
    const { packJson } = submission;
    const curriculumId = slugify(packJson.curriculum);
    const versionId = `${curriculumId}-${slugify(packJson.versionLabel)}`;
    const gradeId = slugify(packJson.grade);
    const subjectId = slugify(packJson.subject);

    if (!curriculaById.has(curriculumId)) {
      curriculaById.set(curriculumId, {
        curriculumId,
        name: packJson.curriculum,
        publisher: packJson.publisher,
        board: packJson.board,
        status: submission.reviewStatus || 'community',
        versionsById: new Map(),
      });
    }
    const curriculum = curriculaById.get(curriculumId);
    // The most recently published submission's call on Official vs.
    // Community wins if these ever disagree across a curriculum's
    // submissions — an edge case this milestone doesn't need
    // reviewer tooling to resolve more carefully than that.
    curriculum.status = submission.reviewStatus || curriculum.status;

    if (!curriculum.versionsById.has(versionId)) {
      curriculum.versionsById.set(versionId, {
        versionId,
        versionLabel: packJson.versionLabel,
        academicYear: packJson.academicYear,
        language: packJson.language,
        gradesById: new Map(),
      });
    }
    const version = curriculum.versionsById.get(versionId);

    if (!version.gradesById.has(gradeId)) {
      version.gradesById.set(gradeId, { id: gradeId, name: packJson.grade, subjects: [] });
    }
    const grade = version.gradesById.get(gradeId);

    const subjectEntry = { id: subjectId, name: packJson.subject, submissionId: submission.id };
    const existingIndex = grade.subjects.findIndex((s) => s.id === subjectId);
    if (existingIndex >= 0) {
      grade.subjects[existingIndex] = subjectEntry; // a republished subject replaces the old reference
    } else {
      grade.subjects.push(subjectEntry);
    }
  }

  return [...curriculaById.values()].map((curriculum) => ({
    curriculumId: curriculum.curriculumId,
    name: curriculum.name,
    publisher: curriculum.publisher,
    board: curriculum.board,
    status: curriculum.status,
    versions: [...curriculum.versionsById.values()].map((version) => ({
      versionId: version.versionId,
      versionLabel: version.versionLabel,
      academicYear: version.academicYear,
      language: version.language,
      grades: [...version.gradesById.values()],
    })),
  }));
}

/** `{ official: Curriculum[], community: Curriculum[] }` — everything Browse Curriculum Library renders. Genuinely empty on a fresh install — see this file's own header comment. */
export async function getLibrary() {
  const allCurricula = buildLibraryFromPublishedSubmissions();
  return {
    official: allCurricula.filter((c) => c.status === 'official'),
    community: allCurricula.filter((c) => c.status !== 'official'),
  };
}

export async function getAllCurricula() {
  const library = await getLibrary();
  return [...library.official, ...library.community];
}

export async function getCurriculumById(curriculumId) {
  const curricula = await getAllCurricula();
  return curricula.find((c) => c.curriculumId === curriculumId) || null;
}

/** The most recently published version — today, simply the last entry in `versions` (built in publish order). Returns `null` for a curriculum with no version, which can no longer actually happen once nothing is hardcoded — kept for defensive symmetry with getVersionById(). */
export function getLatestVersion(curriculum) {
  return curriculum.versions[curriculum.versions.length - 1] || null;
}

export function getVersionById(curriculum, versionId) {
  return curriculum.versions.find((v) => v.versionId === versionId) || null;
}

/** Every Subject entry (with its submissionId) across every Grade in a version, flattened — used to build a version's Subjects summary for a curriculum card, and by getAssignedPackForSubject() below. */
export function getSubjectsInVersion(version) {
  return (version?.grades || []).flatMap((grade) => grade.subjects.map((subject) => ({ ...subject, gradeId: grade.id, gradeName: grade.name })));
}

/**
 * Fetches one Grade/Subject's actual pack content (Units + Concepts)
 * by the submission that supplied it — no network fetch anymore,
 * since a published submission's full content already lives in
 * services/curriculumSubmissionsService.js's storage, not a separate
 * file on disk.
 */
export async function getPack(submissionId) {
  const submission = curriculumSubmissionsService.getSubmissionById(submissionId);
  if (!submission) throw new Error(`No submission found for id "${submissionId}"`);
  return submission.packJson;
}

/**
 * Flattens one unit of a pack into the generic shape
 * services/conceptImportService.js's importConceptsIntoUnit() expects
 * — used by the bulk-import path (ui/views/AddConceptsView.js).
 */
export function getUnitAsImportCandidate(pack, unit) {
  return {
    sourceLabel: `${unit.title} \u2014 ${pack.curriculum} ${pack.grade} ${pack.subject}`,
    conceptTitles: [...(unit.concepts || [])],
  };
}

/**
 * Curriculum-First Navigation's core move: a teacher browsing an
 * assigned curriculum never manually creates a Unit or Concept —
 * clicking one in the tree just needs it to exist. Finds an existing
 * LearningUnit/LearningConcept by title under the given (already
 * chosen) classroom Subject, creating whichever part is missing, so
 * browsing the same curriculum concept twice reuses the same real
 * objects instead of creating duplicates.
 */
export function materializeUnitAndConcept(classroom, subject, unitTitle, conceptTitle) {
  let unit = subject.units.find((u) => u.title === unitTitle);
  if (!unit) {
    unit = learningRecordTeacherService.createUnit(classroom, subject.id, { title: unitTitle });
  }

  let concept = unit.concepts.find((c) => c.title === conceptTitle);
  if (!concept) {
    concept = learningRecordTeacherService.createConcept(classroom, unit.id, { title: conceptTitle });
  }

  return { unit, concept };
}

// ---- Classroom curriculum assignment -----------------------------------
//
// "Schools should only store `assignedCurriculumId` [and versionId].
// Never duplicate the curriculum itself." See models/Classroom.js's
// own doc comment for the `curriculumAssignment` field this reads and
// writes — deliberately just two IDs, nothing else.

export function getCurriculumAssignment(classroom) {
  return classroom.curriculumAssignment || null;
}

export function setCurriculumAssignment(classroom, { curriculumId, versionId }) {
  classroom.curriculumAssignment = { curriculumId, versionId };
  return classroom.curriculumAssignment;
}

export function clearCurriculumAssignment(classroom) {
  classroom.curriculumAssignment = null;
}

/**
 * The one lookup Learning Management needs: given a classroom's
 * already-assigned curriculum *version* and a ClassMate Subject the
 * teacher picked (e.g. "Science"), find the matching pack
 * automatically — matched by subject *name*, case-insensitively,
 * since one version can cover several subjects.
 *
 * Returns `null` — not an error — when there's no assignment yet, the
 * assigned version no longer exists (defensive against a curriculum
 * being removed after assignment), or that version has no subject
 * entry matching this name. Every case means the same thing to a
 * caller: there's nothing to auto-load, fall back to manual
 * Unit/Concept creation, with no picker shown for that fallback
 * either — see ui/views/LearningManagementView.js.
 */
export async function getAssignedPackForSubject(classroom, subjectTitle) {
  const assignment = getCurriculumAssignment(classroom);
  if (!assignment || !assignment.versionId) return null; // defensive against the pre-versioning assignment shape too

  const curriculum = await getCurriculumById(assignment.curriculumId);
  if (!curriculum) return null;

  const version = getVersionById(curriculum, assignment.versionId);
  if (!version) return null;

  const subjectEntries = getSubjectsInVersion(version);
  const matchingEntry = subjectEntries.find((entry) => entry.name.trim().toLowerCase() === subjectTitle.trim().toLowerCase());
  if (!matchingEntry) return null;

  return getPack(matchingEntry.submissionId);
}

/**
 * A flat, pick-one list — every curriculum in the Library that has at
 * least one published version, each reduced to just what a teacher
 * needs to choose one: `{ curriculumId, curriculumName, versionId,
 * versionLabel }`. This is the one shared data source behind two
 * different pickers:
 *   - ui/components/NewClassroomModal.js — Curriculum is now a
 *     required field at classroom creation.
 *   - ui/views/AssignCurriculumPromptView.js — the one-time prompt an
 *     existing classroom sees if it predates that requirement and has
 *     no assignment yet.
 * Both pickers are deliberately simple, flat lists, not the richer
 * Official/Community browsing experience Curriculum Management's own
 * Browse Curriculum Library screen offers — a teacher picking a
 * curriculum for their class needs "which one," not a full library
 * tour. On a fresh install with nothing published yet, this list is
 * genuinely empty — see ui/components/NewClassroomModal.js's own
 * handling of that state.
 */
export async function getAssignableCurriculumOptions() {
  const curricula = await getAllCurricula();
  return curricula
    .filter((curriculum) => getLatestVersion(curriculum))
    .map((curriculum) => {
      const version = getLatestVersion(curriculum);
      return {
        curriculumId: curriculum.curriculumId,
        curriculumName: curriculum.name,
        versionId: version.versionId,
        versionLabel: version.versionLabel,
      };
    });
}
