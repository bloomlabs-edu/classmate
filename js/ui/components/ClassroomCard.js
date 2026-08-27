/**
 * ui/components/ClassroomCard.js
 *
 * Renders one classroom summary card for the Home dashboard: display
 * name (Classroom Name if set, otherwise Grade / Section), an optional
 * subtitle for context, and student/teacher counts. Purely props-driven —
 * the display name, subtitle, and counts are all computed by the view
 * (see ui/views/PersonalHubView.js) using classroomService's read-only
 * selectors, not by this component. `isOwner`/`onDeleteClassroom` are
 * the one exception to "purely props-driven, no logic" — see
 * createActionsMenu() below for why that stays a plain callback too
 * (the confirm dialog and the actual delete call live in main.js, same
 * as onNewClassroom/onJoinClassroom already do for this same view).
 *
 * STRUCTURAL NOTE: this card used to be a single <button> for its
 * entire surface. Adding a second, independent control (the ⋯ actions
 * button) meant that could no longer be true — a <button> nested
 * inside another <button> is invalid HTML and behaves inconsistently
 * across browsers. The outer element is now a plain <div> carrying the
 * card's own visual treatment (background/border/radius/shadow/padding
 * — unchanged from before), with the "open this classroom" behavior
 * moved to its own inner <button> that fills the same space and reads
 * the same content, and the ⋯ button as an independent sibling. Visual
 * appearance, dimensions, and hover behavior are unchanged by this —
 * only which element is actually clickable for which purpose.
 */

// Ensures only one classroom card's own actions menu is ever open at
// once, across the whole grid — opening a second one closes whichever
// other card's menu was already open, the same "one popover at a
// time" rule the student notification bell already enforces for
// itself (see StudentNotificationBell.js), just scoped across sibling
// card instances instead of module-level renders of the same one.
let closeActiveMenu = null;

export function createClassroomCardElement({ displayName, subtitle, studentCount, memberCount, onClick, isOwner, onDeleteClassroom }) {
  const card = document.createElement('div');
  card.className = 'classroom-card';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'classroom-card__open-button';
  openButton.setAttribute('aria-label', `Open ${displayName}`);
  openButton.addEventListener('click', () => onClick?.());

  const title = document.createElement('h2');
  title.className = 'classroom-card__name';
  title.textContent = displayName;
  openButton.appendChild(title);

  if (subtitle) {
    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'classroom-card__subtitle';
    subtitleEl.textContent = subtitle;
    openButton.appendChild(subtitleEl);
  }

  const meta = document.createElement('p');
  meta.className = 'classroom-card__meta';
  meta.textContent = `${studentCount} Student${studentCount === 1 ? '' : 's'} · ${memberCount} Teacher${memberCount === 1 ? '' : 's'}`;
  openButton.appendChild(meta);

  card.appendChild(openButton);

  // Only the owner ever sees this at all — matches the exact same gate
  // ui/views/SettingsView.js's own Danger Zone already uses
  // (memberService.isOwner), so a non-owner never sees a control that
  // would do nothing for them.
  if (isOwner) {
    card.appendChild(createActionsMenu({ displayName, onDeleteClassroom }));
  }

  return card;
}

/**
 * The ⋯ button + its small menu. `onDeleteClassroom` is called with no
 * arguments once the user has clicked "Delete Classroom" in this
 * menu — this component never shows a confirmation dialog and never
 * calls workspaceService itself; that lives in main.js, exactly where
 * onNewClassroom/onJoinClassroom's own real behavior already lives for
 * this same view, not duplicated here.
 */
function createActionsMenu({ displayName, onDeleteClassroom }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'classroom-card__actions';

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'classroom-card__menu-button';
  menuButton.setAttribute('aria-label', `Actions for ${displayName}`);
  menuButton.setAttribute('aria-haspopup', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.textContent = '⋯';

  const menu = document.createElement('div');
  menu.className = 'classroom-card__menu';
  menu.hidden = true;

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.className = 'classroom-card__menu-item';
  deleteItem.textContent = 'Delete Classroom';

  function closeMenu() {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', handleOutsideClick);
    if (closeActiveMenu === closeMenu) closeActiveMenu = null;
  }

  function handleOutsideClick(event) {
    if (!wrapper.contains(event.target)) closeMenu();
  }

  function openMenu() {
    // Only one menu open at a time, across every card in the grid.
    closeActiveMenu?.();
    menu.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    closeActiveMenu = closeMenu;
    // Deferred to the next tick, same reason StudentNotificationBell.js's
    // own toggle defers this: the click that just opened the menu is
    // still bubbling toward `document` at this exact moment, and
    // attaching the listener synchronously would let that same click
    // immediately look like an "outside" click and close the menu
    // right back.
    setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
  }

  // Sibling elements, not nested — clicking this button can never
  // trigger openButton's own click handler above, since click events
  // only bubble to ancestors, never to siblings. stopPropagation() here
  // is still needed for a different reason: without it, this click
  // would bubble to `document` and immediately satisfy the outside-click
  // listener the very first time the menu opens... except the listener
  // isn't attached yet at that point (see the deferred setTimeout
  // above) — so this specifically guards the CLOSE path, where a second
  // click on the same button while the menu is already open must not
  // also register as an "outside" click via document's own listener.
  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  deleteItem.addEventListener('click', (event) => {
    event.stopPropagation();
    closeMenu();
    onDeleteClassroom?.();
  });

  menu.appendChild(deleteItem);
  wrapper.append(menuButton, menu);
  return wrapper;
}
