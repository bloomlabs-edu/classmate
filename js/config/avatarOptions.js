/**
 * config/avatarOptions.js
 *
 * Every choice available in the Student Portal's avatar builder, as
 * data — not hardcoded into the builder UI or the renderer. Adding a
 * new hair style or accessory means adding one entry here and, if it's
 * a genuinely new shape, one new case in utils/avatarRenderer.js —
 * never touching the builder screen itself.
 *
 * Deliberately a flat, layered system (skin tone + hair + expression +
 * optional glasses + optional accessory) rather than static pre-drawn
 * images per combination — the same approach Duolingo/Bitmoji-style
 * avatar builders use, so the option count multiplies combinatorially
 * instead of needing new artwork for every combination.
 *
 * No photo uploads anywhere (see org data-handling rules and this
 * project's own established "no profile photos" policy in
 * RecognitionCard.js) — every option here is a flat illustration
 * choice, never a real image of the student.
 *
 * `label` values are neutral ("Tone 1"..."Tone 5") rather than named
 * after real skin colors — this is a cosmetic customization choice
 * for a cartoon character, not data collected about a student's real
 * appearance, and neutral labels keep it that way.
 */

export const SKIN_TONES = Object.freeze([
  { id: 'tone-1', label: 'Tone 1', hex: '#FFDBB4' },
  { id: 'tone-2', label: 'Tone 2', hex: '#EEC39A' },
  { id: 'tone-3', label: 'Tone 3', hex: '#D8A272' },
  { id: 'tone-4', label: 'Tone 4', hex: '#A9714D' },
  { id: 'tone-5', label: 'Tone 5', hex: '#7A4B32' },
]);

export const HAIR_STYLES = Object.freeze([
  { id: 'bald', label: 'Bald' },
  { id: 'short', label: 'Short' },
  { id: 'curly', label: 'Curly' },
  { id: 'long', label: 'Long' },
  { id: 'buzz', label: 'Buzz Cut' },
  { id: 'pigtails', label: 'Pigtails' },
]);

export const HAIR_COLORS = Object.freeze([
  { id: 'black', label: 'Black', hex: '#2b2b2b' },
  { id: 'brown', label: 'Brown', hex: '#6b4423' },
  { id: 'blonde', label: 'Blonde', hex: '#e8c568' },
  { id: 'red', label: 'Red', hex: '#b5502f' },
  { id: 'blue', label: 'Blue', hex: '#4f7cac' },
]);

export const EXPRESSIONS = Object.freeze([
  { id: 'happy', label: 'Happy' },
  { id: 'excited', label: 'Excited' },
  { id: 'calm', label: 'Calm' },
  { id: 'cool', label: 'Cool' },
]);

export const GLASSES_OPTIONS = Object.freeze([
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
]);

export const ACCESSORY_OPTIONS = Object.freeze([
  { id: 'none', label: 'None' },
  { id: 'headband', label: 'Headband' },
  { id: 'bow', label: 'Bow' },
  { id: 'cap', label: 'Cap' },
]);

/**
 * Every new student sees this before ever touching the avatar builder
 * — matches the decision to keep onboarding frictionless (a default
 * look now, customize later from Profile), not a forced setup step.
 */
export const DEFAULT_AVATAR_CONFIG = Object.freeze({
  skinTone: 'tone-2',
  hairStyle: 'short',
  hairColor: 'brown',
  expression: 'happy',
  glasses: 'none',
  accessory: 'none',
});

export function isValidAvatarConfig(config) {
  if (!config || typeof config !== 'object') return false;
  return (
    SKIN_TONES.some((o) => o.id === config.skinTone) &&
    HAIR_STYLES.some((o) => o.id === config.hairStyle) &&
    HAIR_COLORS.some((o) => o.id === config.hairColor) &&
    EXPRESSIONS.some((o) => o.id === config.expression) &&
    GLASSES_OPTIONS.some((o) => o.id === config.glasses) &&
    ACCESSORY_OPTIONS.some((o) => o.id === config.accessory)
  );
}
