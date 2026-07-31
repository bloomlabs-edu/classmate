/**
 * ui/components/CurriculumMetadataLine.js
 *
 * The frozen design, implemented exactly: Curriculum is always
 * visible on the Subject page, shown as quiet metadata directly
 * beneath the Subject title — never its own card, never competing
 * with Units for visual weight. An icon stands in for the word
 * "Curriculum" (the label itself is training-wheels a teacher reads
 * past after the first few visits); only "Change"/"Assign Curriculum"
 * reads as interactive, kept immediately adjacent to the curriculum
 * name (or "No curriculum assigned.") rather than pushed to the far
 * edge, so the action never visually disconnects from the thing it
 * acts on.
 *
 * A new Subject has no curriculum by default — this is the common
 * state now, not a rare edge case: "No curriculum assigned." plus a
 * real, wired "Assign Curriculum" action (see
 * ui/components/AssignCurriculumModal.js), since a teacher explicitly
 * creates a Subject first (ui/components/AddSubjectModal.js) and
 * assigns it a curriculum as a separate, later step.
 *
 * "Change" (once a curriculum *is* assigned) is present but
 * deliberately does nothing yet — changing curriculum has genuine
 * data consequences (Units/Concepts/Resources are materialized from
 * the curriculum at assignment time), and that confirmation flow is
 * explicitly a later, separately-built piece of work, not a full
 * click here.
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

export function renderCurriculumMetadataLine(container, { curriculumState, onAssignCurriculum }) {
  container.innerHTML = '';

  const line = document.createElement('div');
  line.className = 'curriculum-metadata-line';
  container.appendChild(line);

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

  if (curriculumState.status === 'none') {
    const icon = document.createElement('span');
    icon.className = 'curriculum-metadata-line__icon';
    icon.textContent = '\ud83d\udcd6';
    line.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'curriculum-metadata-line__text';
    text.textContent = 'No curriculum assigned.';
    line.appendChild(text);

    const assignButton = document.createElement('button');
    assignButton.type = 'button';
    assignButton.className = 'curriculum-metadata-line__change';
    assignButton.textContent = 'Assign Curriculum';
    assignButton.addEventListener('click', onAssignCurriculum);
    line.appendChild(assignButton);
    return;
  }

  const { curriculumIndex } = curriculumState;

  const icon = document.createElement('span');
  icon.className = 'curriculum-metadata-line__icon';
  icon.textContent = '\ud83d\udcd6';
  line.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'curriculum-metadata-line__text';
  text.textContent = `${curriculumIndex.curriculum.name} \u00b7 ${curriculumIndex.curriculum.grade}`;
  line.appendChild(text);

  const changeButton = document.createElement('button');
  changeButton.type = 'button';
  changeButton.className = 'curriculum-metadata-line__change';
  changeButton.textContent = 'Change';
  // Deliberately no click handler yet — see this file's own header
  // comment.
  line.appendChild(changeButton);
}
