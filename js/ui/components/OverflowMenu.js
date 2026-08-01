/**
 * ui/components/OverflowMenu.js
 *
 * The platform-wide standard for management actions on *standalone*
 * objects — Curriculum cards, Assessment cards, Resource/Worksheet/
 * Quiz cards, Recognition cards. Navigation lists (Subject lists, Unit
 * lists, Concept lists, Student lists, Assessment subject lists) do
 * NOT use this — those simply navigate on click with a chevron (see
 * ui/components/NavigationRow.js instead). This distinction is a
 * platform design rule, not a per-screen styling choice.
 *
 * `actions` is an array of { label, onClick, danger? }. `danger: true`
 * (e.g. "Delete", "Remove from Assessment") styles that one row
 * distinctly from the rest, without needing a whole second visual
 * language for destructive actions.
 *
 * Closes on: choosing an action, clicking anywhere outside it, or
 * pressing Escape — never left open by accident to be triggered
 * later by an unrelated click elsewhere on the page.
 *
 * Exactly one overflow menu is ever open at a time, platform-wide —
 * a module-level `currentlyOpenMenu` tracks it. This fixes a real bug
 * found during this refactor: each trigger's click handler called
 * `event.stopPropagation()`, which silently prevented the click from
 * ever reaching `document`'s own "close on outside click" listener —
 * meaning clicking a *different* row's ⋮ never closed whichever menu
 * was already open elsewhere on the page, and both could end up open
 * and visually overlapping at once. Opening any menu now explicitly
 * closes whatever else is currently open first, before doing anything
 * else.
 */

let currentlyOpenMenu = null;

export function createOverflowMenu({ actions, ariaLabel = 'Actions' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'overflow-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'overflow-menu__trigger';
  trigger.textContent = '\u22ee';
  trigger.setAttribute('aria-label', ariaLabel);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  wrapper.appendChild(trigger);

  const dropdown = document.createElement('div');
  dropdown.className = 'overflow-menu__dropdown';
  dropdown.hidden = true;

  actions.forEach(({ label, onClick, danger = false }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'overflow-menu__item' + (danger ? ' overflow-menu__item--danger' : '');
    item.textContent = label;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      close();
      onClick();
    });
    dropdown.appendChild(item);
  });

  wrapper.appendChild(dropdown);

  function open() {
    if (currentlyOpenMenu && currentlyOpenMenu !== api) currentlyOpenMenu.close();
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onKeyDown);
    currentlyOpenMenu = api;
  }

  function close() {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeyDown);
    if (currentlyOpenMenu === api) currentlyOpenMenu = null;
  }

  function onOutsideClick(event) {
    if (!wrapper.contains(event.target)) close();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }

  const api = { close };

  trigger.addEventListener('click', (event) => {
    // Still stops propagation so this click isn't immediately treated
    // as an "outside click" of *this* menu — but closing any
    // previously-open menu no longer depends on that same event
    // reaching document, since open() explicitly closes it above.
    event.stopPropagation();
    if (dropdown.hidden) open();
    else close();
  });

  return wrapper;
}

/**
 * A card/row combining a clickable title with an overflow menu on the
 * right — for standalone objects only (see this file's own header
 * comment). Navigation lists use ui/components/NavigationRow.js
 * instead, which has no menu at all.
 */
export function createCardRowWithOverflowMenu({ label, onClick, actions, ariaLabel }) {
  const row = document.createElement('div');
  row.className = 'card-row-with-overflow-menu';

  const titleButton = document.createElement('button');
  titleButton.type = 'button';
  titleButton.className = 'learning-management__choice-option card-row-with-overflow-menu__title';
  titleButton.textContent = label;
  titleButton.addEventListener('click', onClick);
  row.appendChild(titleButton);

  row.appendChild(createOverflowMenu({ actions, ariaLabel: ariaLabel || `${label} actions` }));

  return row;
}
