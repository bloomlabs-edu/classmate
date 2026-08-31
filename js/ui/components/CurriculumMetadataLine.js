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
 * | {status:'none'} | {status:'error'}. The actual fetch (via
 * services/curriculumIndexRepository.js's getIndex()) happens once,
 * in ui/views/LearningManagementView.js's onChooseSubject handler,
 * and is cached there — deliberately not repeated here, since this
 * component re-renders every time a teacher navigates between Parts,
 * and re-fetching (and re-flashing "Loading…") on every one of those
 * clicks would be a real, avoidable annoyance for data that never
 * changed.
 */

export function renderCurriculumMetadataLine(container, { curriculumState }) {
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
    text.textContent = 'Curriculum: Not assigned';
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
