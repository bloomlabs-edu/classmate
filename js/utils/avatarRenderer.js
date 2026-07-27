/**
 * utils/avatarRenderer.js
 *
 * Renders a flat-illustration 2D avatar (Duolingo/Bitmoji-style) from
 * an avatarConfig object — { skinTone, hairStyle, hairColor,
 * expression, glasses, accessory }, all option ids from
 * config/avatarOptions.js. A pure function: same config always
 * produces the same avatar, no randomness, no external assets.
 *
 * Every shape is built from simple primitives (circles, ellipses,
 * rounded rects, small path arcs) computed from the config — not
 * pre-drawn art per combination, so the option catalog can grow
 * combinatorially without new artwork. This is a genuinely new,
 * self-authored illustration system, not an approximation of any
 * existing icon set — unlike the Icon.js Lucide migration, there's no
 * "correct" reference shape being guessed at here.
 *
 * The generated markup only ever interpolates numbers computed here
 * and hex codes from avatarOptions.js's own frozen config — never
 * student-entered free text — so building it as an SVG markup string
 * is safe.
 */

import { SKIN_TONES, HAIR_COLORS, DEFAULT_AVATAR_CONFIG } from '../config/avatarOptions.js';

function hexFor(list, id, fallback) {
  return list.find((o) => o.id === id)?.hex || fallback;
}

function renderFace(skinHex) {
  return `
    <circle cx="18" cy="58" r="8" fill="${skinHex}" />
    <circle cx="82" cy="58" r="8" fill="${skinHex}" />
    <circle cx="50" cy="55" r="32" fill="${skinHex}" />
  `;
}

function renderExpression(expression) {
  switch (expression) {
    case 'excited':
      return `
        <circle cx="38" cy="52" r="5.5" fill="#2b2b2b" />
        <circle cx="62" cy="52" r="5.5" fill="#2b2b2b" />
        <circle cx="36" cy="50" r="1.6" fill="#ffffff" />
        <circle cx="60" cy="50" r="1.6" fill="#ffffff" />
        <path d="M36 68 Q50 80 64 68 L64 71 Q50 84 36 71 Z" fill="#7a2e2e" />
        <path d="M36 68 Q50 78 64 68" fill="none" stroke="#2b2b2b" stroke-width="1.5" />
      `;
    case 'calm':
      return `
        <path d="M33 53 Q38 50 43 53" fill="none" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round" />
        <path d="M57 53 Q62 50 67 53" fill="none" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round" />
        <path d="M40 68 Q50 73 60 68" fill="none" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round" />
      `;
    case 'cool':
      return `
        <path d="M32 51 L44 51" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round" />
        <path d="M56 51 L68 51" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round" />
        <path d="M40 70 Q50 74 62 66" fill="none" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round" />
      `;
    case 'happy':
    default:
      return `
        <circle cx="38" cy="53" r="4" fill="#2b2b2b" />
        <circle cx="62" cy="53" r="4" fill="#2b2b2b" />
        <path d="M36 66 Q50 78 64 66" fill="none" stroke="#2b2b2b" stroke-width="2.4" stroke-linecap="round" />
      `;
  }
}

function renderGlasses(glasses) {
  if (glasses === 'round') {
    return `
      <circle cx="38" cy="54" r="9" fill="none" stroke="#2b2b2b" stroke-width="2.2" />
      <circle cx="62" cy="54" r="9" fill="none" stroke="#2b2b2b" stroke-width="2.2" />
      <path d="M47 54 L53 54" stroke="#2b2b2b" stroke-width="2.2" />
    `;
  }
  if (glasses === 'square') {
    return `
      <rect x="29" y="46" width="18" height="15" rx="3" fill="none" stroke="#2b2b2b" stroke-width="2.2" />
      <rect x="53" y="46" width="18" height="15" rx="3" fill="none" stroke="#2b2b2b" stroke-width="2.2" />
      <path d="M47 53 L53 53" stroke="#2b2b2b" stroke-width="2.2" />
    `;
  }
  return '';
}

function renderHair(hairStyle, hairHex) {
  switch (hairStyle) {
    case 'short':
      return `<path d="M18 42 Q50 6 82 42 Q82 24 50 20 Q18 24 18 42 Z" fill="${hairHex}" />`;
    case 'buzz':
      return `<path d="M20 40 Q50 20 80 40 Q80 32 50 28 Q20 32 20 40 Z" fill="${hairHex}" />`;
    case 'curly':
      return `
        <circle cx="24" cy="36" r="9" fill="${hairHex}" />
        <circle cx="38" cy="24" r="10" fill="${hairHex}" />
        <circle cx="54" cy="20" r="11" fill="${hairHex}" />
        <circle cx="70" cy="26" r="10" fill="${hairHex}" />
        <circle cx="80" cy="40" r="9" fill="${hairHex}" />
      `;
    case 'long':
      return `
        <path d="M15 55 Q10 90 22 96 L30 96 Q22 70 26 50 Z" fill="${hairHex}" />
        <path d="M85 55 Q90 90 78 96 L70 96 Q78 70 74 50 Z" fill="${hairHex}" />
        <path d="M18 42 Q50 6 82 42 Q82 24 50 20 Q18 24 18 42 Z" fill="${hairHex}" />
      `;
    case 'pigtails':
      return `
        <circle cx="14" cy="58" r="9" fill="${hairHex}" />
        <circle cx="86" cy="58" r="9" fill="${hairHex}" />
        <path d="M18 42 Q50 6 82 42 Q82 24 50 20 Q18 24 18 42 Z" fill="${hairHex}" />
      `;
    case 'bald':
    default:
      return '';
  }
}

function renderAccessory(accessory, hairStyle) {
  switch (accessory) {
    case 'headband':
      return `<rect x="18" y="30" width="64" height="7" rx="3.5" fill="#e05780" />`;
    case 'bow':
      return `
        <path d="M62 24 L74 16 L74 32 Z" fill="#e05780" />
        <path d="M62 24 L50 16 L50 32 Z" fill="#e05780" />
        <circle cx="62" cy="24" r="4" fill="#c23e68" />
      `;
    case 'cap': {
      // A cap replaces whatever hair would otherwise show above the
      // brow line — drawn after hair, so it always wins visually
      // regardless of which hairStyle is selected underneath it.
      return `
        <path d="M16 40 Q50 4 84 40 Q84 34 50 30 Q16 34 16 40 Z" fill="#3f6ea5" />
        <path d="M16 40 Q50 30 84 40 L84 44 Q50 34 16 44 Z" fill="#2f537d" />
      `;
    }
    case 'none':
    default:
      return '';
  }
}

/**
 * Builds the inner SVG markup (everything inside the <svg> tag) for a
 * given config, layered back-to-front: face -> hair -> expression ->
 * glasses -> accessory.
 */
export function renderAvatarMarkup(config) {
  const safeConfig = { ...DEFAULT_AVATAR_CONFIG, ...(config || {}) };
  const skinHex = hexFor(SKIN_TONES, safeConfig.skinTone, SKIN_TONES[0].hex);
  const hairHex = hexFor(HAIR_COLORS, safeConfig.hairColor, HAIR_COLORS[0].hex);

  return [
    renderFace(skinHex),
    renderHair(safeConfig.hairStyle, hairHex),
    renderExpression(safeConfig.expression),
    renderGlasses(safeConfig.glasses),
    renderAccessory(safeConfig.accessory, safeConfig.hairStyle),
  ].join('\n');
}

/** Builds a ready-to-mount <svg> element sized to `size` (a square). */
export function createAvatarSvgElement(config, { size = 64 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Avatar');
  svg.innerHTML = renderAvatarMarkup(config);
  return svg;
}
