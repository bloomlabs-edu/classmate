/**
 * ui/components/SearchableSelect.js
 *
 * A reusable, always-interactive dropdown field — click opens a list
 * of existing options, typing filters it, and an option that doesn't
 * exist yet can be created and selected in the same motion. Built to
 * replace free-text fields that leaned on a static placeholder hint
 * ("e.g. Tamil Nadu State Board") as their only guidance — a
 * placeholder is not an affordance; this is meant to be the one
 * component every such field in the app uses instead, in Curriculum
 * Management now and anywhere else later (Learning Management,
 * Assessment Management, ...) rather than each screen growing its own
 * slightly-different dropdown.
 *
 * `options` accepts either plain strings or `{ value, label }` pairs —
 * plain strings are normalized to `{ value: s, label: s }`
 * internally, which is all Board and Grade need (a board's name *is*
 * its identity). Subject needs the richer form, since a canonical
 * subject has a stable id distinct from its display title (see
 * services/subjectIdentityService.js) — this component doesn't know
 * or care about that distinction itself; it just carries whatever
 * `value` the caller associated with each `label`.
 *
 * `onSelect(value, { label, isNew })` fires once, whether the teacher
 * picked an existing option or typed something new and confirmed
 * "+ Create". This component never decides what "creating" an option
 * means beyond that — for Board, the caller simply uses the typed
 * text directly (a board's name IS the record); for Subject, the
 * caller is expected to generate a real id from it (see
 * services/subjectIdentityService.js's generateCustomSubjectId()).
 * Keeping that decision in the caller is what keeps this component
 * genuinely reusable rather than quietly Subject-specific.
 *
 * Exactly one SearchableSelect's dropdown is ever open at a time,
 * platform-wide — and, via utils/popupCoordinator.js's shared
 * registry, coordinated with every other dismissible popup type in
 * the app too (ui/components/OverflowMenu.js in particular), not just
 * other SearchableSelects. See that file's own header comment for why
 * a per-file tracker alone isn't enough: opening one explicitly closes
 * whatever else — of any kind — is currently open, rather than
 * relying on each component only knowing about its own type.
 */

import { registerOpenPopup, clearOpenPopup } from '../../utils/popupCoordinator.js';

export function createSearchableSelect({ options, value = '', placeholder = 'Type to search\u2026', onSelect, allowCustom = true }) {
  let normalizedOptions = options.map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : opt));

  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-select';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-select__input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  const initialOption = normalizedOptions.find((opt) => opt.value === value);
  input.value = initialOption ? initialOption.label : value || '';
  wrapper.appendChild(input);

  const dropdown = document.createElement('div');
  dropdown.className = 'searchable-select__dropdown';
  dropdown.hidden = true;
  wrapper.appendChild(dropdown);

  let selectedValue = value;

  function close() {
    dropdown.hidden = true;
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeyDown);
    clearOpenPopup(api);
  }

  function open() {
    registerOpenPopup(api);
    renderOptions();
    dropdown.hidden = false;
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onKeyDown);
  }

  function onOutsideClick(event) {
    if (!wrapper.contains(event.target)) close();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') {
      event.preventDefault();
      const typed = input.value.trim();
      if (!typed) return;
      const exactMatch = normalizedOptions.find((opt) => opt.label.toLowerCase() === typed.toLowerCase());
      if (exactMatch) {
        choose(exactMatch.value, exactMatch.label, false);
      } else if (allowCustom) {
        choose(typed, typed, true);
      }
    }
  }

  function choose(chosenValue, label, isNew) {
    selectedValue = chosenValue;
    input.value = label;
    close();
    onSelect(chosenValue, { label, isNew });
  }

  function renderOptions() {
    dropdown.innerHTML = '';
    const typed = input.value.trim().toLowerCase();
    const matches = typed ? normalizedOptions.filter((opt) => opt.label.toLowerCase().includes(typed)) : normalizedOptions;

    matches.forEach((opt) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'searchable-select__option';
      row.textContent = opt.label;
      row.addEventListener('click', () => choose(opt.value, opt.label, false));
      dropdown.appendChild(row);
    });

    const exactMatch = normalizedOptions.some((opt) => opt.label.toLowerCase() === typed);
    if (allowCustom && typed && !exactMatch) {
      const createRow = document.createElement('button');
      createRow.type = 'button';
      createRow.className = 'searchable-select__option searchable-select__option--create';
      createRow.textContent = `+ Create "${input.value.trim()}"`;
      createRow.addEventListener('click', () => choose(input.value.trim(), input.value.trim(), true));
      dropdown.appendChild(createRow);
    }

    if (matches.length === 0 && !(allowCustom && typed && !exactMatch)) {
      const emptyNote = document.createElement('p');
      emptyNote.className = 'searchable-select__empty';
      emptyNote.textContent = 'No matches.';
      dropdown.appendChild(emptyNote);
    }
  }

  input.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dropdown.hidden) open();
  });
  input.addEventListener('input', () => {
    if (dropdown.hidden) open();
    else renderOptions();
  });

  function getValue() {
    return selectedValue;
  }

  /** Replaces the option list — used when suggestions load asynchronously (e.g. Board's suggestions come from existing stored curricula, not a static config). Re-renders the dropdown immediately if it's currently open. */
  function setOptions(newOptions) {
    normalizedOptions = newOptions.map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : opt));
    if (!dropdown.hidden) renderOptions();
  }

  const api = { wrapper, getValue, setOptions, close };
  return api;
}
