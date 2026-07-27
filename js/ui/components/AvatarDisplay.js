/**
 * ui/components/AvatarDisplay.js
 *
 * The one place every Student Portal screen goes through to show a
 * person's avatar — so each screen doesn't independently decide
 * between the new illustrated avatar and the old initials fallback.
 *
 * Behavior:
 *   - If this device has a saved avatarConfig for the given
 *     studentId (see services/avatarConfigService.js), render the
 *     illustrated avatar.
 *   - Otherwise, if `useDefaultIfMissing` is set (i.e. this is the
 *     current student themselves — see decision to keep onboarding
 *     frictionless with a default look), render the default
 *     illustrated avatar rather than initials.
 *   - Otherwise (someone else's avatar this device has never seen —
 *     a teammate, another name on the join roster), fall back to the
 *     existing initials-plus-color avatar. This is the honest
 *     behavior for Phase 1: this device genuinely doesn't know what
 *     that other student picked.
 *
 * Deliberately not used anywhere in Classroom Tracker's own teacher
 * views (RecognitionCard, GroupsWidget, TeamCard) — those keep their
 * own existing initials logic unchanged, per the explicit decision to
 * scope this to the Student Portal only.
 */

import { createAvatarSvgElement } from '../../utils/avatarRenderer.js';
import { getAvatarConfig, getAvatarConfigOrDefault } from '../../services/avatarConfigService.js';
import { getAvatarForPerson } from '../../utils/avatarGenerator.js';

/**
 * @param {Object} options
 * @param {string} [options.studentId] - looked up in this device's local avatar config
 * @param {string} [options.name] - used for the initials fallback and as a label
 * @param {number} [options.size=48]
 * @param {boolean} [options.useDefaultIfMissing=false] - true for "self" contexts
 * @param {string} [options.className]
 */
export function createAvatarElement({ studentId, name, size = 48, useDefaultIfMissing = false, className } = {}) {
  const config = useDefaultIfMissing ? getAvatarConfigOrDefault(studentId) : getAvatarConfig(studentId);

  const wrapper = document.createElement('span');
  wrapper.className = className ? `avatar-display ${className}` : 'avatar-display';
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;

  if (config) {
    wrapper.appendChild(createAvatarSvgElement(config, { size }));
    return wrapper;
  }

  // Initials fallback — same visual language this app already uses
  // everywhere else (RecognitionCard, GroupsWidget, TeamCard).
  const fallback = getAvatarForPerson({ name });
  wrapper.classList.add('avatar-display--initials');
  wrapper.style.backgroundColor = fallback.color;
  wrapper.style.fontSize = `${Math.round(size * 0.4)}px`;
  wrapper.textContent = fallback.initials;
  return wrapper;
}
