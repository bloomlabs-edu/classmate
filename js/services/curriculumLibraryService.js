/**
 * services/curriculumLibraryService.js
 *
 * The global Curriculum Library — exists independently of schools and
 * classrooms. Schools and teachers don't own curricula; they browse,
 * install, and assign them (see ui/views/CurriculumManagementView.js's
 * Browse Curriculum Library / Curriculum Details / Assign to Class
 * screens). Data model:
 *
 *   CurriculumLibrary
 *     Official | Community           (see data/curriculum/manifest.json)
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
 * Loaded from static JSON files (see data/curriculum/manifest.json and
 * data/curriculum/*.json) via fetch() — no bundler, no build step,
 * matching how every other static asset in this app is served today.
 * Each version's actual Grade/Subject pack content is fetched lazily,
 * only once a teacher drills into it, and cached in memory.
 *
 * Consumed by:
 *   - ui/views/CurriculumManagementView.js's Browse/Details/Assign
 *     screens, and its Contribute Curriculum flow (which submits new
 *     curricula for review — see services/contributedCurriculaService.js
 *     — rather than writing into this file's data directly; nothing
 *     is added to the Library until approved).
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

const MANIFEST_PATH = 'data/curriculum/manifest.json';
const PACK_DIR = 'data/curriculum/';

let manifestCache = null;
const packCache = new Map();

export async function getManifest() {
  if (manifestCache) return manifestCache;
  const response = await fetch(MANIFEST_PATH);
  if (!response.ok) throw new Error(`Failed to load curriculum manifest (${response.status})`);
  manifestCache = await response.json();
  return manifestCache;
}

/** `{ official: Curriculum[], community: Curriculum[] }` — everything Browse Curriculum Library renders. */
export async function getLibrary() {
  const manifest = await getManifest();
  return { official: manifest.official || [], community: manifest.community || [] };
}

export async function getAllCurricula() {
  const library = await getLibrary();
  return [...library.official, ...library.community];
}

export async function getCurriculumById(curriculumId) {
  const curricula = await getAllCurricula();
  return curricula.find((c) => c.curriculumId === curriculumId) || null;
}

/** The most recently published version — today, simply the last entry in `versions` (each curriculum's own manifest entry lists them oldest-first). Returns `null` if nothing's been published yet (see NCERT/CBSE/Kerala State Board/Cambridge IGCSE in the sample data — listed for browsing, no version yet). */
export function getLatestVersion(curriculum) {
  return curriculum.versions[curriculum.versions.length - 1] || null;
}

export function getVersionById(curriculum, versionId) {
  return curriculum.versions.find((v) => v.versionId === versionId) || null;
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
 * tour. Curricula with no published version (browsable in Curriculum
 * Management, but nothing to assign) are correctly excluded here.
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

/** Every Subject entry (with its packFile) across every Grade in a version, flattened — used to build a version's Subjects summary for a curriculum card, and by getAssignedPackForSubject() below. */
export function getSubjectsInVersion(version) {
  return (version?.grades || []).flatMap((grade) => grade.subjects.map((subject) => ({ ...subject, gradeId: grade.id, gradeName: grade.name })));
}

/** Fetches and caches one Grade/Subject's actual pack content (Units + Concepts) by its manifest-listed file name. */
export async function getPack(packFile) {
  if (packCache.has(packFile)) return packCache.get(packFile);
  const response = await fetch(PACK_DIR + packFile);
  if (!response.ok) throw new Error(`Failed to load curriculum pack "${packFile}" (${response.status})`);
  const pack = await response.json();
  packCache.set(packFile, pack);
  return pack;
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
 * assigned version no longer exists (defensive against manifest
 * changes), or that version has no subject entry matching this name.
 * Every case means the same thing to a caller: there's nothing to
 * auto-load, fall back to manual Unit/Concept creation, with no
 * picker shown for that fallback either — see
 * ui/views/LearningManagementView.js.
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

  return getPack(matchingEntry.packFile);
}
