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
 * `textColor` is white (`#ffffff`) for every preset, per explicit
 * product decision — a consistent look across every accent color takes
 * priority over the per-background WCAG optimization this file used to
 * do. Worth being direct about the trade-off this reverses: Ocean and
 * Sunset are light enough that white measures below the standard
 * 4.5:1 AA threshold (2.64:1 / 3.19:1) — dark ink was used there for a
 * period specifically because of that math, and this change
 * knowingly moves away from it again, now in the other direction, for
 * both. See CHANGELOG.md for the full numbers and history of both
 * changes.
 */

export const ACCENT_COLOR_OPTIONS = Object.freeze([
  {
    id: 'ocean',
    label: 'Ocean',
    hex: '#5ea6da',
    textColor: '#ffffff',
    shadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
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
    textColor: '#ffffff',
    shadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
]);

export const DEFAULT_ACCENT_COLOR_ID = 'ocean';

export function getAccentColorById(id) {
  return ACCENT_COLOR_OPTIONS.find((option) => option.id === id) || ACCENT_COLOR_OPTIONS.find((option) => option.id === DEFAULT_ACCENT_COLOR_ID);
}
