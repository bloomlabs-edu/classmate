/**
 * services/unitPageRangeService.js
 *
 * A Curriculum Index Unit only ever stores `printedPage` — where it
 * starts (see services/curriculumIndexRepository.js's own record
 * shape). There is no persisted `endPage` field, deliberately: this
 * file computes one on demand instead, so there's never a second,
 * separately-stored page number that could drift out of sync with
 * `printedPage` itself or with a Unit that got reordered/deleted after
 * an endPage was last saved.
 *
 * Derivation: a Unit's own end page is the next Unit's printedPage
 * minus one, walking `index.units` in its own array order — the same
 * order that already represents actual textbook page order (Units
 * reference their Part by id rather than being nested inside it,
 * specifically so this flat, page-ordered array stays intact
 * regardless of which Part a Unit belongs to — see
 * services/curriculumIndexRepository.js's own header comment). The
 * last Unit in the array has no next Unit to derive an end page from,
 * so its range is genuinely open-ended — this is returned as `null`,
 * not guessed at, since there's no retained PDF page count to fall
 * back on for a Curriculum Index built from pasted text alone (see
 * this project's own Curriculum Builder design discussion for why
 * that gap is real and not silently worked around here).
 */

/**
 * Returns `{ startPage, endPage }` for one Unit, or `null` if the
 * Unit has no printedPage at all (added by hand, never extracted from
 * a real page). `endPage` is `null` specifically for the last Unit in
 * `index.units`' own order — an honest "open-ended" rather than a
 * fabricated number.
 */
export function getDerivedPageRange(index, unitId) {
  const unitIndex = index.units.findIndex((unit) => unit.id === unitId);
  if (unitIndex === -1) return null;

  const unit = index.units[unitIndex];
  if (unit.printedPage == null) return null;

  const nextUnit = index.units[unitIndex + 1];
  const endPage = nextUnit && nextUnit.printedPage != null ? nextUnit.printedPage - 1 : null;

  return { startPage: unit.printedPage, endPage };
}
