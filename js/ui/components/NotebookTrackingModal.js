/**
 * ui/components/NotebookTrackingModal.js
 *
 * Per-notebook-type "Tracking Method" configuration — opened from
 * Settings > Notebooks (ui/views/SettingsView.js) via a small settings
 * button next to each notebook type row. Lets a teacher switch a
 * notebook type between Checkpoints (the original behavior) and Daily
 * Check (services/dailyCheckService.js), and, for Daily Check,
 * configure scoring and manage excluded (holiday/no-check) dates —
 * all through the existing notebookConfigService.js mutators, never a
 * parallel config path. Every change here applies immediately and
 * persists right away (markDirty + saveExplicitly), matching this
 * Settings screen's own existing rename/remove convention — there is
 * no separate "Save" step to remember.
 *
 * Two internal "screens" in one modal (`main` and `holidays`) rather
 * than a second nested modal, per explicit "keep the hierarchy simple"
 * instruction for this feature.
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as workspaceService from '../../services/workspaceService.js';
import { createIcon } from './Icon.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

const SCORE_PRESETS = [5, 10];

export function openNotebookTrackingModal({ classroom, notebookType, onChanged }) {
  let screen = 'main';

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
    modal.setAttribute('aria-label', 'Notebook tracking settings');
    overlay.appendChild(modal);

    if (screen === 'holidays') {
      modal.appendChild(renderHolidaysScreen());
    } else {
      modal.appendChild(renderMainScreen());
    }
  }

  function renderMainScreen() {
    const fragment = document.createDocumentFragment();

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = `Tracking Method — ${notebookType.name}`;
    fragment.appendChild(heading);

    const trackingMode = notebookConfigService.getTrackingMode(notebookType);

    const modeGroup = document.createElement('div');
    modeGroup.className = 'notebook-tracking-modal__option-group';

    modeGroup.appendChild(
      renderRadioOption({
        name: 'trackingMode',
        checked: trackingMode === 'checkpoint',
        title: 'Checkpoints',
        description: 'Track progress through named units or checkpoints.',
        onSelect: () => {
          notebookConfigService.setTrackingMode(classroom, notebookType.id, 'checkpoint');
          persistAndRerender();
        },
      })
    );
    modeGroup.appendChild(
      renderRadioOption({
        name: 'trackingMode',
        checked: trackingMode === 'daily',
        title: 'Daily Check',
        description: 'Check this notebook on working days and track daily consistency/streaks.',
        onSelect: () => {
          notebookConfigService.setTrackingMode(classroom, notebookType.id, 'daily');
          persistAndRerender();
        },
      })
    );
    fragment.appendChild(modeGroup);

    if (trackingMode === 'daily') {
      fragment.appendChild(renderDailySettingsSection());
    }

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'btn btn--primary';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', close);
    fragment.appendChild(doneButton);

    return fragment;
  }

  function renderDailySettingsSection() {
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
        name: 'scoringEnabled',
        checked: !scoringEnabled,
        title: 'Off',
        description: 'Just record whether the daily check was completed.',
        onSelect: () => {
          notebookConfigService.setDailySettings(classroom, notebookType.id, { scoringEnabled: false });
          persistAndRerender();
        },
      })
    );
    scoringGroup.appendChild(
      renderRadioOption({
        name: 'scoringEnabled',
        checked: scoringEnabled,
        title: 'On',
        description: 'Record a score for each daily check.',
        onSelect: () => {
          notebookConfigService.setDailySettings(classroom, notebookType.id, { scoringEnabled: true });
          persistAndRerender();
        },
      })
    );
    section.appendChild(scoringGroup);

    if (scoringEnabled) {
      section.appendChild(renderScoreMaxPicker());
    }

    const holidaysRow = document.createElement('div');
    holidaysRow.className = 'notebook-tracking-modal__holidays-row';
    const holidaysLabel = document.createElement('div');
    const holidaysTitle = document.createElement('p');
    holidaysTitle.className = 'notebook-tracking-modal__section-heading';
    holidaysTitle.textContent = 'Holidays / No-check days';
    const excludedCount = notebookType.dailySettings?.excludedDates?.length || 0;
    const holidaysDescription = document.createElement('p');
    holidaysDescription.className = 'notebook-tracking-modal__section-description';
    holidaysDescription.textContent = excludedCount > 0 ? `${excludedCount} date${excludedCount === 1 ? '' : 's'} marked` : 'No dates marked yet.';
    holidaysLabel.append(holidaysTitle, holidaysDescription);
    holidaysRow.appendChild(holidaysLabel);

    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'btn btn--secondary';
    manageButton.textContent = 'Manage dates →';
    manageButton.addEventListener('click', () => {
      screen = 'holidays';
      render();
    });
    holidaysRow.appendChild(manageButton);
    section.appendChild(holidaysRow);

    return section;
  }

  function renderScoreMaxPicker() {
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
        persistAndRerender();
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
          persistAndRerender();
        }
      });
      wrap.appendChild(customInput);
    } else {
      customButton.addEventListener('click', () => {
        // Switch into custom mode with no value chosen yet — the input
        // above only renders once currentMax stops matching a preset.
        notebookConfigService.setDailySettings(classroom, notebookType.id, { scoreMax: 0 });
        persistAndRerender();
      });
    }

    return wrap;
  }

  function renderHolidaysScreen() {
    const fragment = document.createDocumentFragment();

    const backRow = document.createElement('button');
    backRow.type = 'button';
    backRow.className = 'btn btn--text';
    backRow.appendChild(createIcon('arrow-left', { size: 16 }));
    backRow.append(' Back');
    backRow.addEventListener('click', () => {
      screen = 'main';
      render();
    });
    fragment.appendChild(backRow);

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = `Holidays / No-check days — ${notebookType.name}`;
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
      persistAndRerenderHolidaysScreen();
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
          persistAndRerenderHolidaysScreen();
        });
        row.append(label, removeButton);
        list.appendChild(row);
      });
      fragment.appendChild(list);
    }

    return fragment;
  }

  function persistAndRerenderHolidaysScreen() {
    workspaceService.markDirty(classroom.id);
    workspaceService.saveExplicitly(classroom).catch(() => {});
    onChanged?.();
    render(); // screen is still 'holidays' at this point — render() re-reads it fresh
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
