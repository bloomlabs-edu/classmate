/**
 * config/accentColorConfig.js
 *
 * Accent-color options a teacher can choose between (5 presets, plus a
 * full-spectrum custom picker in the UI — see UserBar.js) — applied to
 * every "solid blue chrome" surface across the app (headers, Primary
 * buttons, the KPI card, team card headers, Recognition's avatar) since
 * all of those already reference the same two tokens
 * (--color-primary-deep / --color-on-primary-deep) rather than a
 * hardcoded color.
 *
 * `textColor` is a WCAG-driven fact about each background, not a style
 * preference — every pairing here is computed and verified directly
 * (not estimated) before being added. Ocean and Sunset are both light
 * enough that white fails (2.64:1 / 3.19:1), so both use dark ink
 * instead (6.58:1 / 5.45:1); Classic/Emerald/Plum are dark enough that
 * white passes (5.75:1 / 6.01:1 / 6.35:1) and dark ink would fail. See
 * CHANGELOG.md for the full numbers and history — including the
 * earlier version of this file, where Ocean was a stated exception
 * kept on white text despite failing contrast; that exception is now
 * reversed in favor of the same "light background -> dark ink" rule
 * every other preset already follows.
 *
 * `shadow` pairs with `textColor`: a dark drop-shadow behind white text
 * adds a little legibility against a busy background; behind dark ink
 * it would do nothing useful, so both presets using dark ink (Ocean,
 * Sunset) have none.
 */

export const ACCENT_COLOR_OPTIONS = Object.freeze([
  {
    id: 'ocean',
    label: 'Ocean',
    hex: '#5ea6da',
    /* Per explicit product decision: white text on this background
       measured 2.64:1, below the standard 4.5:1 threshold — an
       earlier, deliberate override kept white anyway as a stated
       product trade-off. That trade-off is now reversed: dark ink
       measures 6.58:1 on this exact background (verified directly,
       not estimated), comfortably passing, and matches the same
       approach Sunset below already uses for its own light
       background — one consistent rule (light background -> dark
       ink) rather than a one-off exception for this specific color. */
    textColor: '#1a1a1a',
    shadow: 'none',
  },
  {
    id: 'classic',
    label: 'Classic',
    hex: '#1565c0',
    textColor: '#ffffff',
    shadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    hex: '#256f59',
    textColor: '#ffffff',
    shadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  {
    id: 'plum',
    label: 'Plum',
    hex: '#6b4fa8',
    textColor: '#ffffff',
    shadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    hex: '#d9762e',
    textColor: '#1a1a1a',
    shadow: 'none',
  },
]);

export const DEFAULT_ACCENT_COLOR_ID = 'ocean';

export function getAccentColorById(id) {
  return ACCENT_COLOR_OPTIONS.find((option) => option.id === id) || ACCENT_COLOR_OPTIONS.find((option) => option.id === DEFAULT_ACCENT_COLOR_ID);
}
