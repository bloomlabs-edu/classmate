/**
 * ui/components/Icon.js
 *
 * ClassMate's single icon rendering path — see
 * docs/icon-design-guide.md for the full design-system rules this
 * component exists to enforce (when to use an icon at all, outline
 * vs filled, sizing, spacing, accessibility, and when an emoji is the
 * right choice instead).
 *
 * Self-hosted Lucide SVG path data, not a CDN import. This app has no
 * build step — index.html loads ES modules directly in the browser —
 * and Google Fonts was deliberately made non-render-blocking earlier
 * specifically because a third-party CDN can silently stall a page on
 * restricted school networks. Pulling in an icon library the same way
 * would reintroduce that exact risk for a far less critical resource
 * than fonts. Only the icons ClassMate actually uses live here, added
 * one at a time as screens migrate — not the full Lucide set.
 *
 * Every icon is stroke-based (outline, not filled) and uses
 * stroke="currentColor", so it automatically inherits whatever text
 * color its containing button or element already has — no separate
 * color bookkeeping anywhere a new icon is added.
 */

const ICONS = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'file-up':
    '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3.5"/><path d="M12 12v6"/><path d="m9 15 3-3 3 3"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'notebook-text':
    '<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/><path d="M9.5 16h3"/>',
  'book-open':
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'clipboard-list':
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle-2': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  'alert-triangle':
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'graduation-cap':
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  'bar-chart-3': '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  /**
   * Custom icon, not part of official Lucide — a chalkboard on easel
   * legs, built from simple rectangle and straight-line primitives
   * (no curves) to match the two reference images that shaped this
   * choice, at the same 24x24 grid / 2px stroke as every Lucide icon
   * above so it sits consistently alongside them. Used for the
   * Teacher category specifically, replacing bar-chart-3 (which read
   * as "analytics," not "teacher").
   */
  'chalkboard-easel':
    '<rect width="18" height="12" x="3" y="3" rx="1"/><path d="M8 15 5 21"/><path d="M16 15 19 21"/><path d="M7 8h10"/><path d="M7 11h7"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4a4.95 4.95 0 1 0-7 7Z"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  'file-text':
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
};

/**
 * Creates an inline SVG icon. Always decorative by default
 * (aria-hidden) — per the design guide, the icon supplements a
 * visible label or an aria-label already present on its parent
 * button; it is not itself the accessible name.
 */
export function createIcon(name, { size = 20, strokeWidth = 2, className = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  if (className) svg.classList.add(...className.split(' ').filter(Boolean));

  const markup = ICONS[name];
  if (!markup) {
    console.warn(`[Icon] Unknown icon name: "${name}"`);
    return svg;
  }
  svg.innerHTML = markup;
  return svg;
}

/**
 * The eight semantic categories agreed on for icon badges across the
 * app — see docs/icon-design-guide.md for the reasoning behind each
 * color. Deliberately NOT applied to Class Mode's toolbar or any
 * other dense/repeating context (per-student row menus, notebook
 * timeline symbols) — those stay neutral, since they're actions
 * within one context rather than distinct categories to tell apart.
 */
export const ICON_CATEGORIES = Object.freeze({
  teacher: { icon: '#5ea6da', tint: '#E6F1FB', button: '#5ea6da' },
  student: { icon: '#BF5F1A', tint: '#FDEEE0', button: '#ff9b65' },
  groups: { icon: '#0F9E8E', tint: '#E1F5F1' },
  notebook: { icon: '#6D5AC4', tint: '#EEEBFB' },
  recognition: { icon: '#C9971D', tint: '#FBF0D9' },
  progress: { icon: '#4C9A2A', tint: '#EAF5E3' },
  activities: { icon: '#D8546F', tint: '#FBE9ED' },
  settings: { icon: '#5B6672', tint: '#EBEDEF' },
});

/**
 * A soft colored circle containing a neutral icon — the shared
 * "category badge" used wherever a screen needs to tell Teacher,
 * Student, Groups, Notebook, Recognition, Progress, Activities, or
 * Settings apart at a glance. Returns a <span> wrapping the icon;
 * the circle itself is CSS (.icon-badge), not inline styles, so the
 * visual spec lives in one place.
 */
export function createIconBadge(iconName, category, { size = 48, iconSize } = {}) {
  const colors = ICON_CATEGORIES[category];
  if (!colors) {
    console.warn(`[Icon] Unknown icon badge category: "${category}"`);
  }
  const badge = document.createElement('span');
  badge.className = 'icon-badge';
  badge.style.width = `${size}px`;
  badge.style.height = `${size}px`;
  badge.style.backgroundColor = colors ? colors.tint : '#EBEDEF';
  badge.style.color = colors ? colors.icon : '#5B6672';
  badge.appendChild(createIcon(iconName, { size: iconSize || Math.round(size * 0.58), strokeWidth: 1.8 }));
  return badge;
}
