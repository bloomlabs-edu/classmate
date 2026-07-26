/**
 * config/groupColorConfig.js
 *
 * Default colours offered for a Team ("group"). Deliberately excludes
 * red, yellow, and green — those are reserved for Learning Buckets (see
 * config/bucketConfig.js) so a group's colour is never mistaken for a
 * student's bucket. Teachers can change a group's colour at any time
 * (Setup Wizard Step 3, or Settings > Groups later).
 */

export const DEFAULT_GROUP_COLORS = Object.freeze([
  { id: 'blue', label: 'Blue', hex: '#93C5FD' },
  { id: 'purple', label: 'Purple', hex: '#C4B5FD' },
  { id: 'orange', label: 'Orange', hex: '#FDBA74' },
  { id: 'teal', label: 'Teal', hex: '#5EEAD4' },
]);

/** Cycles through DEFAULT_GROUP_COLORS by index, for auto-assigning new teams. */
export function getDefaultGroupColor(index) {
  return DEFAULT_GROUP_COLORS[index % DEFAULT_GROUP_COLORS.length].id;
}

export function getGroupColorHex(colorId) {
  const found = DEFAULT_GROUP_COLORS.find((color) => color.id === colorId);
  return found ? found.hex : '#94a3b8';
}
