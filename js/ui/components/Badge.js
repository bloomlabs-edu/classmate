/**
 * ui/components/Badge.js
 *
 * The Badge & Achievement Engine's one reusable badge component — see
 * docs/design/badges/CLASSMATE_BADGE_SYSTEM_IMPLEMENTATION_STYLEGUIDE.md
 * for the full visual spec this implements (flat-vector shield/emblem,
 * recognition colour = type, level = independent number, visual stage
 * derived from level, star as progression motif).
 *
 * Conceptually exactly the style guide's own example:
 *   <Badge family="weekly-standing" type="winning-team-member" level={5} />
 * — one component, not WinningTeamMemberLevel1/2/3.../. Every visual
 * decision (theme, icon, stage, star count, milestone framing) is
 * derived from config/badgeDefinitions.js's data plus the level
 * number passed in; nothing about a specific badge is hard-coded here.
 *
 * The central icon is NOT redrawn here — it's rendered via
 * ui/components/Icon.js's own createIcon(), the app's single icon
 * rendering path (per the style guide's own Section 18: "the badge
 * should consume an icon rather than embedding an icon directly into
 * the component logic"). Swapping a badge's icon later means changing
 * one string in badgeDefinitions.js, never this file.
 *
 * Flat-vector only: solid fills, simple strokes, no gradients, no
 * bevels, no 3D, no photorealism (style guide Section 9). Stage
 * progression is expressed through border layering, a small corner
 * accent, and star count — never a fundamentally different artwork
 * per level, and never unbounded complexity at high levels (Section
 * 15/16): every level from 20 to 20,000 renders the exact same Master
 * treatment, differing only in the printed number.
 */

import { createIcon } from './Icon.js';
import { getBadgeDefinition, getBadgeStage, BADGE_THEMES } from '../../config/badgeDefinitions.js';

const SHIELD_PATH = 'M50 4 L90 18 L90 52 C90 78 72 94 50 100 C28 94 10 78 10 52 L10 18 Z';

/** How many stars to actually draw — style guide Section 16: stars track level for the first few, then a fixed decorative count at every higher stage rather than literally drawing dozens. */
function starCountForStage(stageId) {
  switch (stageId) {
    case 'starting-out':
      return 1;
    case 'building':
      return 2;
    case 'established':
    case 'elite':
    case 'master':
      return 3;
    default:
      return 1;
  }
}

function buildStar(fill) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.classList.add('badge-emblem__star');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M12 2.5 L14.9 8.6 L21.5 9.5 L16.8 14.1 L17.9 20.6 L12 17.5 L6.1 20.6 L7.2 14.1 L2.5 9.5 L9.1 8.6 Z'
  );
  path.setAttribute('fill', fill);
  svg.appendChild(path);
  return svg;
}

/**
 * The shield/emblem silhouette itself — one flat path, filled with the
 * theme's primary colour, with a layered border whose thickness
 * (single vs. double ring) is the one piece of stage-driven geometric
 * variation the style guide asks for (Section 13: "Building" adds a
 * secondary border; "Established" and above keep it). A small diamond
 * accent appears from "Established" up, and a pair of simple flanking
 * flourish strokes (a plain-vector stand-in for the style guide's
 * "laurel/wings") appear at "Elite" and "Master" — still flat vector,
 * never more than these few extra shapes regardless of how high the
 * level climbs.
 */
function buildShield(theme, stageId) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 104');
  svg.classList.add('badge-emblem__shield');

  const outer = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outer.setAttribute('d', SHIELD_PATH);
  outer.setAttribute('fill', theme.primary);
  svg.appendChild(outer);

  const hasDoubleRing = stageId && stageId !== 'starting-out';
  const inner = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  inner.setAttribute('d', SHIELD_PATH);
  inner.setAttribute('fill', 'none');
  inner.setAttribute('stroke', theme.dark);
  inner.setAttribute('stroke-width', hasDoubleRing ? '4' : '2.5');
  inner.setAttribute(
    'transform',
    hasDoubleRing ? 'translate(50 52) scale(0.9) translate(-50 -52)' : 'translate(50 52) scale(0.96) translate(-50 -52)'
  );
  svg.appendChild(inner);

  const showAccent = ['established', 'elite', 'master'].includes(stageId);
  if (showAccent) {
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    diamond.setAttribute('d', 'M50 8 L56 16 L50 24 L44 16 Z');
    diamond.setAttribute('fill', theme.accent);
    svg.appendChild(diamond);
  }

  const showFlourish = ['elite', 'master'].includes(stageId);
  if (showFlourish) {
    [-1, 1].forEach((direction) => {
      const flourish = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const x = 50 + direction * 34;
      flourish.setAttribute('d', `M${50 + direction * 12} 30 Q${x} 40 ${50 + direction * 10} 58`);
      flourish.setAttribute('fill', 'none');
      flourish.setAttribute('stroke', theme.accent);
      flourish.setAttribute('stroke-width', '3');
      flourish.setAttribute('stroke-linecap', 'round');
      svg.appendChild(flourish);
    });
  }

  const field = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  field.setAttribute('cx', '50');
  field.setAttribute('cy', '46');
  field.setAttribute('r', '26');
  field.setAttribute('fill', theme.light);
  svg.appendChild(field);

  return svg;
}

/**
 * Builds one badge emblem. `level` of 0/undefined renders a "not yet
 * earned" outline treatment (still the correct silhouette/icon/colour,
 * just desaturated) — used by a future "badges you haven't earned yet"
 * display; today's callers only ever pass a real, already-earned level.
 *
 * `size` in px, matching the style guide's own required range
 * (24-160+). At sizes below 48px the star row and level ribbon are
 * omitted entirely (Section 19/27: "simplify rather than shrink every
 * detail" — silhouette, colour, and icon are the only things that must
 * survive at small sizes).
 */
export function createBadge({ family, recognitionType, level = 0, size = 64, showLevel = true }) {
  const definition = getBadgeDefinition(family, recognitionType);

  const wrapper = document.createElement('div');
  wrapper.className = 'badge-emblem-wrapper';
  wrapper.style.width = `${size}px`;

  if (!definition) {
    // Unknown badge — never throws, never renders fabricated content (style guide Section 27's own "no arbitrary colours" spirit extended to "no arbitrary badges").
    wrapper.classList.add('badge-emblem-wrapper--unknown');
    return wrapper;
  }

  const theme = BADGE_THEMES[definition.theme];
  const stage = getBadgeStage(level);
  const earned = level > 0;

  const emblem = document.createElement('div');
  emblem.className = 'badge-emblem' + (earned ? '' : ' badge-emblem--unearned');
  emblem.style.width = `${size}px`;
  emblem.style.height = `${size}px`;
  emblem.title = definition.title;

  emblem.appendChild(buildShield(theme, stage?.id));

  const iconSize = Math.round(size * 0.36);
  const icon = createIcon(definition.icon, { size: iconSize, strokeWidth: 2 });
  icon.classList.add('badge-emblem__icon');
  icon.style.color = theme.dark;
  emblem.appendChild(icon);

  if (earned && size >= 32) {
    const starRow = document.createElement('div');
    starRow.className = 'badge-emblem__star-row';
    const starCount = starCountForStage(stage?.id);
    for (let i = 0; i < starCount; i += 1) {
      starRow.appendChild(buildStar(theme.accent));
    }
    emblem.appendChild(starRow);
  }

  wrapper.appendChild(emblem);

  if (earned && showLevel && size >= 48) {
    const levelLabel = document.createElement('span');
    levelLabel.className = 'badge-emblem__level';
    levelLabel.style.color = theme.dark;
    levelLabel.textContent = `LV ${level}`;
    wrapper.appendChild(levelLabel);
  }

  return wrapper;
}
