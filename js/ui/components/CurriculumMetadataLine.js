/**
 * ui/components/CurriculumMetadataLine.js
 *
 * Curriculum is always visible on the Subject page, shown as quiet
 * metadata directly beneath the Subject title — never its own card,
 * never competing with Units for visual weight. An icon stands in for
 * the word "Curriculum" (the label itself is training-wheels a
 * teacher reads past after the first few visits).
 *
 * "Not assigned" (status 'none') is a real, distinct state shown just
 * as plainly as an actual assignment — CURRICULUM ASSIGNMENT is its
 * own relationship, separate from the Subject existing at all (see
 * ui/components/AddSubjectModal.js's own header comment), so a
 * brand-new Subject with nothing linked yet should say so, not go
 * silent.
 *
 * `unitCount` (status 'none' only) distinguishes a genuinely empty
 * Subject from one that already has real Units with no Curriculum
 * Index linked — investigated directly against
 * services/curriculumLinkingService.js: assignCurriculumToSubject()/
 * createSubjectWithCurriculum() always set linkedCurriculumIndexId and
 * every Unit's own linkedCurriculumUnitId together, atomically
 * (models/LearningSubject.js's own factory is the only other place
 * linkedCurriculumIndexId is ever set, and only to its `null` default),
 * and no code path anywhere clears the Subject-level link while
 * leaving Units in place.
 *
 * CORRECTION (2026-09-11, second browser-feedback pass) — this file
 * previously claimed a Subject in this state could only mean
 * hand-entered Units, "no separate resource anywhere in this data
 * model for such a link to have pointed to." That was wrong, and the
 * investigation that produced it stopped one layer too early.
 * services/curriculumIndexRepository.js stores the actual Curriculum
 * Index record (name, board, grade, Units) in **IndexedDB — this
 * browser's own local database, never Firestore, never synced across
 * devices** (see that file's own header comment: "A separate IndexedDB
 * database..."). `subject.linkedCurriculumIndexId` itself IS a
 * Firestore field and travels with the classroom everywhere. So a
 * Subject can absolutely have a real, non-null `linkedCurriculumIndexId`
 * — set on the device/browser where a teacher originally ran "Assign
 * Curriculum" — while `curriculumIndexRepository.getIndex(id)` returns
 * `null` on a *different* device/browser (or after this browser's
 * IndexedDB was cleared), because that specific record never existed
 * there. ui/views/LearningManagementView.js's loadCurriculumStateFor()
 * used to collapse exactly that case into the same `{status:'none'}}`
 * as a Subject that was never linked at all — genuinely indistinguishable
 * states in the UI, even though the underlying facts are completely
 * different (one has a real link the app just can't resolve locally;
 * the other never had one). Status 'missing' (below) is that
 * previously-collapsed case, kept separate from 'none' specifically so
 * this component never again claims "no Curriculum Index linked" for a
 * Subject that actually has one — it just says the honest thing
 * instead: linked, but unavailable here. Never claims a curriculum
 * *name* in this state — that's exactly the fabrication the investigation
 * was told not to do, and this component genuinely doesn't know it.
 *
 * Given all that, plain "Curriculum: Not assigned" reads as "nothing
 * real exists yet," which is false for a Subject with real Units and,
 * worse, undersells what may be a teacher's own substantial,
 * deliberately-entered (or genuinely linked-elsewhere) sequence — see
 * the distinct wording below, which states the actual Unit count
 * instead of just "custom." Never inferred from Unit titles, never a
 * guess at provenance — purely "does linkedCurriculumIndexId exist,"
 * "did it resolve," and "how many Units exist," all already-known facts.
 *
 * Pure display only — no buttons live here anymore. Simplified per
 * explicit product decision: the overflow-menu pattern this used to
 * pair with was causing recurring positioning bugs, and this
 * screen's own actions (fewer than three of them) don't genuinely
 * need a menu at all. "Change Curriculum" / "Assign Curriculum" are
 * now real, visible buttons rendered by the caller (see
 * ui/views/LearningManagementView.js's renderSubjectStep()), directly
 * beneath this line — this component's only job is showing what's
 * currently assigned, not deciding what a teacher can do about it.
 *
 * A pure, synchronous renderer of whatever `curriculumState` already
 * is — one of {status:'loading'} | {status:'ready', curriculumIndex}
 * | {status:'none'} | {status:'missing'} | {status:'error'}. The
 * actual fetch (via services/curriculumIndexRepository.js's getIndex())
 * happens once, in ui/views/LearningManagementView.js's
 * loadCurriculumStateFor(), and is cached there — deliberately not
 * repeated here, since this component re-renders every time a teacher
 * navigates between Parts, and re-fetching (and re-flashing
 * "Loading…") on every one of those clicks would be a real, avoidable
 * annoyance for data that never changed.
 */

export function renderCurriculumMetadataLine(container, { curriculumState, unitCount = 0 }) {
  container.innerHTML = '';

  const line = document.createElement('div');
  line.className = 'curriculum-metadata-line';
  container.appendChild(line);

  if (curriculumState.status === 'none') {
    const icon = document.createElement('span');
    icon.className = 'curriculum-metadata-line__icon';
    icon.textContent = '📖';
    line.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'curriculum-metadata-line__text curriculum-metadata-line__text--unassigned';
    // See this file's own header comment: a Subject with real Units
    // but no linked Curriculum Index gets a distinct line — "Not
    // assigned" alone would misread as "nothing exists here yet," and
    // stating the actual count (not just "custom") reads as real,
    // usable content rather than an ad hoc leftover.
    text.textContent = unitCount > 0
      ? `${unitCount} unit${unitCount === 1 ? '' : 's'} added — no Curriculum Index linked`
      : 'Curriculum: Not assigned';
    line.appendChild(text);
    return;
  }

  if (curriculumState.status === 'missing') {
    const icon = document.createElement('span');
    icon.className = 'curriculum-metadata-line__icon';
    icon.textContent = '📖';
    line.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'curriculum-metadata-line__text curriculum-metadata-line__text--unassigned';
    // See this file's own header comment — this Subject genuinely HAS
    // a linkedCurriculumIndexId; the record it points to just isn't in
    // this browser's IndexedDB. Never names a curriculum here — this
    // component has no way to know what it was called.
    text.textContent = 'Curriculum linked, but its details aren’t available on this device/browser';
    line.appendChild(text);
    return;
  }

  if (curriculumState.status === 'loading') {
    const loadingText = document.createElement('span');
    loadingText.className = 'curriculum-metadata-line__text';
    loadingText.textContent = 'Loading\u2026';
    line.appendChild(loadingText);
    return;
  }

  if (curriculumState.status === 'error') {
    const errorText = document.createElement('span');
    errorText.className = 'curriculum-metadata-line__text';
    errorText.textContent = "Couldn't load this Subject's curriculum. Check your connection and try again.";
    line.appendChild(errorText);
    return;
  }

  const icon = document.createElement('span');
  icon.className = 'curriculum-metadata-line__icon';
  icon.textContent = '\ud83d\udcd6';
  line.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'curriculum-metadata-line__text';
  const { curriculumIndex } = curriculumState;
  text.textContent = `Curriculum: ${curriculumIndex.curriculum.name} \u00b7 ${curriculumIndex.curriculum.grade}`;
  line.appendChild(text);
}
