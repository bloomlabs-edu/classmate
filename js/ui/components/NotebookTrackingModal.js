/**
 * ui/components/NotebookTrackingModal.js
 *
 * Per-notebook-type tracking configuration — the current tracking mode
 * and its key settings are always visible on the notebook type's own
 * row in Settings > Notebooks (ui/views/SettingsView.js); this module
 * supplies the inline editor that row expands to show ("Edit
 * tracking"), plus the one genuinely separate flow (managing the list
 * of no-check dates) as a focused modal. Both read/write through the
 * same notebookConfigService.js mutators as before — no parallel
 * config path, and no duplicated Checkpoints/Daily Check logic between
 * the always-visible summary and the editor.
 *
 * renderTrackingEditor() is deliberately just a DOM fragment, not a
 * self-contained widget with its own re-render loop: every control's
 * onSelect persists the change and calls the caller's onChanged(),
 * which (in SettingsView.js) re-renders the whole Settings page from
 * the classroom's own data — same convention as every other Settings
 * mutation already uses. Which row is expanded is separate, ephemeral
 * UI state the caller owns (see SettingsView.js's own
 * expandedTrackingRows Set), so a full page re-render doesn't collapse
 * the row the teacher is actively editing.
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createIcon } from './Icon.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

const SCORE_PRESETS = [5, 10];

/** The inline "Edit tracking" panel content — Tracking mode, and (for Daily Check) Scoring, Maximum score, and the No-check days row. Returns a fragment to append directly into the notebook type's own row. */
export function renderTrackingEditor({ classroom, notebookType, onChanged }) {
  function persist() {
    workspaceService.markDirty(classroom.id);
    workspaceService.saveExplicitly(classroom).catch(() => {});
    onChanged?.();
  }

  const fragment = document.createDocumentFragment();
  const trackingMode = notebookConfigService.getTrackingMode(notebookType);

  const modeHeading = document.createElement('p');
  modeHeading.className = 'notebook-tracking-modal__section-heading';
  modeHeading.textContent = 'Tracking';
  fragment.appendChild(modeHeading);

  const modeGroup = document.createElement('div');
  modeGroup.className = 'notebook-tracking-modal__option-group';
  modeGroup.appendChild(
    renderRadioOption({
      name: `trackingMode-${notebookType.id}`,
      checked: trackingMode === 'checkpoint',
      title: 'Checkpoints',
      description: 'Track progress through named checkpoints or units.',
      onSelect: () => {
        notebookConfigService.setTrackingMode(classroom, notebookType.id, 'checkpoint');
        persist();
      },
    })
  );
  modeGroup.appendChild(
    renderRadioOption({
      name: `trackingMode-${notebookType.id}`,
      checked: trackingMode === 'daily',
      title: 'Daily Check',
      description: 'Check this notebook every working day and track student streaks.',
      onSelect: () => {
        notebookConfigService.setTrackingMode(classroom, notebookType.id, 'daily');
        persist();
      },
    })
  );
  fragment.appendChild(modeGroup);

  if (trackingMode === 'daily') {
    fragment.appendChild(renderDailySettingsSection({ classroom, notebookType, persist, onChanged }));
  }

  return fragment;
}

function renderDailySettingsSection({ classroom, notebookType, persist, onChanged }) {
  const section = document.createElement('div');
  section.className = 'notebook-tracking-modal__section';

  const scoringHeading = document.createElement('p');
  scoringHeading.className = 'notebook-tracking-modal__section-heading';
  scoringHeading.textContent = 'Scoring';
  section.appendChild(scoringHeading);

  const scoringEnabled = Boolean(notebookType.dailySettings?.scoringEnabled);

  const scoringGroup = document.createElement('div');
  scoringGroup.className = 'notebook-tracking-modal__option-group';
  scoringGroup.appendChild(
    renderRadioOption({
      name: `scoringEnabled-${notebookType.id}`,
      checked: !scoringEnabled,
      title: 'Not scored',
      description: 'Just record whether the daily check was completed.',
      onSelect: () => {
        notebookConfigService.setDailySettings(classroom, notebookType.id, { scoringEnabled: false });
        persist();
      },
    })
  );
  scoringGroup.appendChild(
    renderRadioOption({
      name: `scoringEnabled-${notebookType.id}`,
      checked: scoringEnabled,
      title: 'Score each check',
      description: 'Record a score for each daily check.',
      onSelect: () => {
        notebookConfigService.setDailySettings(classroom, notebookType.id, { scoringEnabled: true });
        persist();
      },
    })
  );
  section.appendChild(scoringGroup);

  if (scoringEnabled) {
    section.appendChild(renderScoreMaxPicker({ classroom, notebookType, persist }));
  }

  const holidaysRow = document.createElement('div');
  holidaysRow.className = 'notebook-tracking-modal__holidays-row';
  const holidaysLabel = document.createElement('div');
  const holidaysTitle = document.createElement('p');
  holidaysTitle.className = 'notebook-tracking-modal__section-heading';
  holidaysTitle.textContent = 'No-check days';
  const holidaysDescription = document.createElement('p');
  holidaysDescription.className = 'notebook-tracking-modal__section-description';
  holidaysDescription.textContent = 'Holidays and other excluded dates won’t break student streaks.';
  holidaysLabel.append(holidaysTitle, holidaysDescription);
  holidaysRow.appendChild(holidaysLabel);

  const manageButton = document.createElement('button');
  manageButton.type = 'button';
  manageButton.className = 'btn btn--secondary';
  manageButton.textContent = 'Manage dates →';
  manageButton.addEventListener('click', () => {
    openManageDatesModal({ classroom, notebookType, onChanged });
  });
  holidaysRow.appendChild(manageButton);
  section.appendChild(holidaysRow);

  return section;
}

function renderScoreMaxPicker({ classroom, notebookType, persist }) {
  const wrap = document.createElement('div');
  wrap.className = 'notebook-tracking-modal__score-max';

  const label = document.createElement('p');
  label.className = 'notebook-tracking-modal__section-heading';
  label.textContent = 'Maximum score';
  wrap.appendChild(label);

  const currentMax = notebookType.dailySettings?.scoreMax ?? 5;
  const isPreset = SCORE_PRESETS.includes(currentMax);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'toggle-group';
  SCORE_PRESETS.forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-group__button' + (currentMax === preset ? ' toggle-group__button--active' : '');
    button.textContent = String(preset);
    button.addEventListener('click', () => {
      notebookConfigService.setDailySettings(classroom, notebookType.id, { scoreMax: preset });
      persist();
    });
    buttonRow.appendChild(button);
  });

  const customButton = document.createElement('button');
  customButton.type = 'button';
  customButton.className = 'toggle-group__button' + (!isPreset ? ' toggle-group__button--active' : '');
  customButton.textContent = 'Custom';
  buttonRow.appendChild(customButton);
  wrap.appendChild(buttonRow);

  if (!isPreset) {
    const customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '1';
    customInput.className = 'modal__input notebook-tracking-modal__custom-max-input';
    customInput.placeholder = 'e.g. 20';
    customInput.value = currentMax && !SCORE_PRESETS.includes(currentMax) ? currentMax : '';
    customInput.addEventListener('change', () => {
      const parsed = Number(customInput.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        notebookConfigService.setDailySettings(classroom, notebookType.id, { scoreMax: parsed });
        persist();
      }
    });
    wrap.appendChild(customInput);
  } else {
    customButton.addEventListener('click', () => {
      // Switch into custom mode with no value chosen yet — the input
      // above only renders once currentMax stops matching a preset.
      notebookConfigService.setDailySettings(classroom, notebookType.id, { scoreMax: 0 });
      persist();
    });
  }

  return wrap;
}

/** The one remaining modal here — managing the (potentially long) list of no-check dates is a genuinely separate, occasional flow, not part of the always-visible tracking summary. */
export function openManageDatesModal({ classroom, notebookType, onChanged }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  function persistAndRerender() {
    workspaceService.markDirty(classroom.id);
    workspaceService.saveExplicitly(classroom).catch(() => {});
    onChanged?.();
    render();
  }

  function render() {
    overlay.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'modal modal--wide';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Manage no-check days');
    overlay.appendChild(modal);
    modal.appendChild(renderContent());
  }

  function renderContent() {
    const fragment = document.createDocumentFragment();

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = `No-check days — ${notebookType.name}`;
    fragment.appendChild(heading);

    const description = document.createElement('p');
    description.className = 'modal__description';
    description.textContent = 'Dates marked here are excluded from expected daily checks and never break a student’s streak.';
    fragment.appendChild(description);

    const addRow = document.createElement('div');
    addRow.className = 'notebook-tracking-modal__add-holiday-row';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'modal__input';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--secondary';
    addButton.textContent = 'Add';
    addButton.addEventListener('click', () => {
      if (!dateInput.value) return;
      notebookConfigService.addExcludedDate(classroom, notebookType.id, dateInput.value);
      persistAndRerender();
    });
    addRow.append(dateInput, addButton);
    fragment.appendChild(addRow);

    const excludedDates = [...(notebookType.dailySettings?.excludedDates || [])].sort();
    if (excludedDates.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'modal__description';
      empty.textContent = 'No dates marked yet.';
      fragment.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'notebook-tracking-modal__holiday-list';
      excludedDates.forEach((dateKey) => {
        const row = document.createElement('li');
        row.className = 'notebook-tracking-modal__holiday-row';
        const label = document.createElement('span');
        label.textContent = formatDateKey(dateKey);
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn--text';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
          notebookConfigService.removeExcludedDate(classroom, notebookType.id, dateKey);
          persistAndRerender();
        });
        row.append(label, removeButton);
        list.appendChild(row);
      });
      fragment.appendChild(list);
    }

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'btn btn--primary';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', close);
    fragment.appendChild(doneButton);

    return fragment;
  }

  render();
}

function renderRadioOption({ name, checked, title, description, onSelect }) {
  const label = document.createElement('label');
  label.className = 'notebook-tracking-modal__option' + (checked ? ' notebook-tracking-modal__option--selected' : '');

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.checked = checked;
  input.addEventListener('change', onSelect);
  label.appendChild(input);

  const text = document.createElement('span');
  const titleEl = document.createElement('span');
  titleEl.className = 'notebook-tracking-modal__option-title';
  titleEl.textContent = title;
  const descriptionEl = document.createElement('span');
  descriptionEl.className = 'notebook-tracking-modal__option-description';
  descriptionEl.textContent = description;
  text.append(titleEl, descriptionEl);
  label.appendChild(text);

  return label;
}
