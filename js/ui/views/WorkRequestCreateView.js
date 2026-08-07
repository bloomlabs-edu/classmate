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

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', () => {
    if (!titleInput.value.trim()) return;

    const selectedUnit = selectedUnitId ? unitById.get(selectedUnitId) : null;
    const request = workRequestService.createNewWorkRequest(classroom, {
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
    onCreated(request.id);
  });

  const form = document.createElement('div');
  form.className = 'settings-section';
  form.append(titleInput, dueDateInput, learningContextLabel, learningContextSelect.wrapper, createButton);
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
