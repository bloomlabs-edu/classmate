/**
 * ui/views/WorkRequestCreateView.js
 *
 * Reached only when no WorkRequest is currently open for a given
 * Subject x Notebook Type — services/workRequestService.js's own
 * createNewWorkRequest() throws if one already is (see that
 * function's own header comment for why this doesn't silently
 * auto-close), so this screen never needs to handle that case itself;
 * main.js's own route dispatch already only sends a teacher here when
 * getActiveWorkRequest() found nothing.
 *
 * "Learning Context (Optional)" — a WorkRequest may optionally link
 * to a real curriculum unit, per the frozen curriculum-context
 * architecture (see models/WorkRequest.js's own header comment).
 * Deliberately built as a progressive picker
 * (ui/components/SearchableSelect.js, `allowCustom: false` — an
 * existing option this component already supports, not a new mode),
 * not a radio group: a real curriculum can hold dozens of units, and
 * SearchableSelect is already the app's own established, reusable
 * answer to exactly that scaling problem — this screen doesn't
 * introduce a new interaction pattern, it reuses the one that already
 * exists. Defaults to "None"; selecting a real unit and clearing back
 * to "None" both go through the same control.
 *
 * Units are sourced from services/curriculumLinkingService.js's own
 * getUnitsForNotebookSubject() — the Notebook Subject used here and
 * the Learning Hub's own Subject are two genuinely separate entities
 * with no formal link between them (confirmed directly), so this is
 * matched by name; a classroom with no matching Learning Hub Subject
 * at all correctly shows zero units, not an error, and "Learning
 * Context" simply has nothing to offer beyond "None" in that case.
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as curriculumLinkingService from '../../services/curriculumLinkingService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createSearchableSelect } from '../components/SearchableSelect.js';
import { createBackButton } from '../components/BackButton.js';

const NONE_OPTION_VALUE = '__none__';

export function renderWorkRequestCreateView(container, { classroom, subjectId, notebookTypeId, onBack, onCreated }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'work-request-create';
  wrapper.appendChild(createBackButton(onBack));

  const subject = notebookConfigService.getSubjectById(classroom, subjectId);
  const notebookType = notebookConfigService.listNotebookTypes(classroom, subjectId).find((t) => t.id === notebookTypeId);

  const heading = document.createElement('h1');
  heading.className = 'work-request-create__title';
  heading.textContent = `New ${notebookType?.name || 'Notebook'} Check`;
  wrapper.appendChild(heading);

  const meta = document.createElement('p');
  meta.className = 'work-request-create__meta';
  meta.textContent = subject?.name || '';
  wrapper.appendChild(meta);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'settings-add-row__input';
  titleInput.placeholder = 'e.g. Chapter 4 Notebook Check';
  titleInput.value = `${subject?.name || ''} ${notebookType?.name || ''}`.trim();

  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.className = 'settings-add-row__input';

  const learningContextLabel = document.createElement('label');
  learningContextLabel.className = 'work-request-create__field-label';
  learningContextLabel.textContent = 'Learning Context (Optional)';

  const units = subject ? curriculumLinkingService.getUnitsForNotebookSubject(classroom, subject.name) : [];
  const unitById = new Map(units.map((unit) => [unit.id, unit]));

  const learningContextOptions = [
    { value: NONE_OPTION_VALUE, label: 'None' },
    ...units.map((unit) => ({ value: unit.id, label: formatUnitLabel(unit) })),
  ];

  let selectedUnitId = NONE_OPTION_VALUE;
  const learningContextSelect = createSearchableSelect({
    options: learningContextOptions,
    value: '',
    placeholder: units.length > 0 ? 'None \u2014 tap to select a curriculum unit\u2026' : 'None \u2014 no curriculum units available',
    allowCustom: false,
    onSelect: (value) => {
      selectedUnitId = value;
    },
  });

  // PHASE 8 — RELIABILITY FIX: createNewWorkRequest() only ever mutated
  // classroom.workRequests in memory — nothing on this screen persisted
  // it. In production this meant a newly created request only reached
  // Firestore incidentally, if/when some later, unrelated classroom
  // mutation happened to save the whole classroom document afterwards
  // (see ui/views/WorkRequestRosterView.js's own workspaceService.save()
  // calls) — a teacher who created a check and closed the app without
  // touching anything else would silently lose it. `isSaving` is this
  // screen's own closure-local guard (same idiom as this app's other
  // create/add actions): disable-while-pending, and never navigate via
  // onCreated() until workspaceService.saveExplicitly() has actually
  // resolved, so a rapid re-click can't start a second, overlapping
  // create+save, and a failed save leaves the teacher's entered form
  // values untouched for an immediate retry.
  let isSaving = false;

  const errorNote = document.createElement('p');
  errorNote.className = 'work-request-create__error';
  errorNote.textContent = 'Save failed. Check your connection and try again.';
  errorNote.hidden = true;

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', async () => {
    if (isSaving) return;
    if (!titleInput.value.trim()) return;

    isSaving = true;
    errorNote.hidden = true;
    createButton.disabled = true;
    createButton.textContent = 'Creating…';

    // Declared outside the try so the catch block can see it: if
    // createNewWorkRequest() itself throws (e.g. the pre-existing
    // "already open" business rule, unrelated to this attempt),
    // `request` correctly stays undefined and there is nothing to roll
    // back below.
    let request;
    try {
      const selectedUnit = selectedUnitId ? unitById.get(selectedUnitId) : null;
      request = workRequestService.createNewWorkRequest(classroom, {
        type: 'notebook',
        title: titleInput.value.trim(),
        subjectId,
        notebookTypeId,
        dueDate: dueDateInput.value,
        ...(selectedUnit
          ? {
              curriculumUnitId: selectedUnit.id,
              curriculumUnitNumberSnapshot: selectedUnit.number,
              curriculumUnitTitleSnapshot: selectedUnit.title,
            }
          : {}),
      });

      workspaceService.markDirty(classroom.id);
      await workspaceService.saveExplicitly(classroom);

      // Only navigate once the create is durably on the server —
      // onCreated() drives a full route change, so there's nothing left
      // here to manually re-enable on success.
      onCreated(request.id);
    } catch (error) {
      // createNewWorkRequest() already pushed `request` onto
      // classroom.workRequests in memory before saveExplicitly() ever
      // ran — if the save itself is what failed (not the create call),
      // that in-memory entry must come back out, or a same-data retry
      // would incorrectly hit createNewWorkRequest()'s own "already
      // open" throw instead of genuinely attempting to save again.
      if (request) {
        const index = classroom.workRequests.indexOf(request);
        if (index !== -1) classroom.workRequests.splice(index, 1);
      }
      isSaving = false;
      createButton.disabled = false;
      createButton.textContent = 'Create';
      errorNote.hidden = false;
    }
  });

  const form = document.createElement('div');
  form.className = 'settings-section';
  form.append(titleInput, dueDateInput, learningContextLabel, learningContextSelect.wrapper, createButton, errorNote);
  wrapper.appendChild(form);

  container.appendChild(wrapper);
}

/**
 * "Unit 4 \u2022 Light", or "Part 2 / Unit 4 \u2022 Light" when the
 * unit's own partName is present (models/LearningUnit.js only
 * includes partName at all when the curriculum has more than one
 * part — see curriculumLinkingService.js's buildUnitsFromCurriculumIndex()
 * for why that's conditional, not always-present).
 */
function formatUnitLabel(unit) {
  const numberPrefix = unit.number ? `Unit ${unit.number}` : 'Unit';
  const core = `${numberPrefix} \u2022 ${unit.title}`;
  return unit.partName ? `${unit.partName} / ${core}` : core;
}
