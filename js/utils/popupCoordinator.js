/**
 * utils/popupCoordinator.js
 *
 * A single, shared "which dismissible popup is currently open"
 * registry — used by every component of this kind in the app
 * (ui/components/OverflowMenu.js, ui/components/SearchableSelect.js,
 * and any future one) so that opening any of them closes whichever
 * other one was already open, regardless of type. Each of those files
 * previously tracked its own "currently open" state independently, in
 * its own module-level variable — which correctly prevented two
 * OverflowMenus (or two SearchableSelects) from both being open, but
 * did nothing to stop an OverflowMenu and a SearchableSelect being
 * open at the same time, since neither file knew the other existed.
 * This is the fix: one shared registry, one rule, enforced
 * platform-wide, for any popup type that registers with it.
 *
 * A "popup" here is any object exposing a `close()` method — that's
 * the entire contract. Nothing here knows or cares whether it's an
 * overflow menu, a searchable-select dropdown, or something built
 * later; it only ever calls `close()` on whatever was previously
 * registered.
 */

let currentlyOpenPopup = null;

/** Call when a popup opens. Closes whatever else was open first, then registers this one as the current one. */
export function registerOpenPopup(popup) {
  if (currentlyOpenPopup && currentlyOpenPopup !== popup) {
    currentlyOpenPopup.close();
  }
  currentlyOpenPopup = popup;
}

/** Call when a popup closes (including when it closes itself, not just via another popup opening). Only clears the registry if this popup is actually the one currently registered — closing an already-closed or superseded popup should never accidentally clear a different, later-opened one. */
export function clearOpenPopup(popup) {
  if (currentlyOpenPopup === popup) {
    currentlyOpenPopup = null;
  }
}
