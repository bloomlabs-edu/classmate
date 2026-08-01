/**
 * ui/components/BackButton.js
 *
 * The single, platform-wide standard for the back-navigation action on
 * every page header — plain "← Back", never a destination-specific
 * label ("Back to Dashboard," "Back to Learning Management," "Back to
 * My Classrooms," etc.). Per explicit product decision: a page's own
 * back action should read the same everywhere, because what it means
 * is always the same thing — return one level up the navigation
 * stack, to whatever the teacher was actually doing before. Naming
 * the destination in the label invites exactly the wrong mental model
 * (that Back is a shortcut to a specific place) instead of the right
 * one (Back undoes the last navigation step, wherever that leads).
 *
 * Every one of this app's ~20+ existing back buttons used the exact
 * same `btn btn--text` + arrow-left icon + text structure before this
 * component existed, just built by hand in each file with a different
 * trailing label — this is that same structure, extracted once. A
 * page inside a colored header (see ui/views/StudentProfileView.js,
 * ui/views/SettingsView.js, ui/views/TrackerView.js) needs no special
 * variant here: those headers already override `.btn--text`'s color
 * via their own parent-selector CSS rules
 * (`.profile-header .btn--text`, etc.), so the same plain button
 * reads correctly in both a colored header and a plain white one.
 */

import { createIcon } from './Icon.js';

export function createBackButton(onClick) {
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back');
  backButton.addEventListener('click', onClick);
  return backButton;
}
