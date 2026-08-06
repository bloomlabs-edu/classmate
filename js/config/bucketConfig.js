/**
 * config/bucketConfig.js
 *
 * Learning Buckets are a per-student classification: Green, Yellow, Red,
 * or Not Assigned. Names are fixed and never relabeled anywhere in the
 * app. Scoring per bucket is configurable per classroom (see
 * config/classroomDefaults.js / services/bucketService.js).
 *
 * These colours are reserved for buckets specifically — see
 * config/groupColorConfig.js, whose group colours deliberately avoid
 * red/yellow/green so a group's colour is never confused with a
 * student's bucket.
 *
 * BUCKET_ROW_STYLES gives the Tracker's soft pastel treatment (light
 * background + a coloured left border) rather than a solid colour dot —
 * chosen for contrast/accessibility against the student name's text.
 */

export const BUCKET_KEYS = Object.freeze(['green', 'yellow', 'red']);

export const BUCKET_LABELS = Object.freeze({
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
});

export const NOT_ASSIGNED_LABEL = 'Not Assigned';

// Used for small solid accents (e.g. an achievement-style chip) where a
// stronger colour reads fine against a white background.
export const BUCKET_DISPLAY_COLORS = Object.freeze({
  green: '#2e7d32',
  yellow: '#b7791f',
  red: '#c62828',
});

// Soft pastel background + left-border treatment for the Tracker's
// student rows and the Student Profile header — deliberately not bright
// solid colours (see the brief). `text` is the correct ink color for
// reading directly against these light backgrounds — every one of them
// is light enough that dark ink is the only choice that stays legible
// (unlike accentColorConfig.js's own accent colors, which are dark
// enough for white text); `#1a1a1a` matches the exact dark ink value
// already established there for the same reason.
//
// `nameColor` is a separate, later addition — dark, desaturated shades
// (dark green / dark amber / dark maroon) meant specifically for a
// student's own name text when a whole row is already bucket-themed
// (see ui/views/WorkRequestRosterView.js), so the name harmonizes with
// the row rather than reading as plain black against a colored
// background. Deliberately not the same value as `border` — border is
// tuned to read well as a thin accent or small swatch; `nameColor` is
// tuned to read well as body text at normal size, over a long list.
export const BUCKET_ROW_STYLES = Object.freeze({
  green: { background: '#EAF7EC', border: '#2e7d32', text: '#1a1a1a', nameColor: '#1b5e20' },
  yellow: { background: '#FFF8E1', border: '#b7791f', text: '#1a1a1a', nameColor: '#8a5a00' },
  red: { background: '#FDECEA', border: '#c62828', text: '#1a1a1a', nameColor: '#7a1f1f' },
  notAssigned: { background: '#F3F4F6', border: '#9AA5B1', text: '#1a1a1a', nameColor: 'var(--color-ink)' },
});

export function getBucketRowStyle(bucketKey) {
  return BUCKET_ROW_STYLES[bucketKey] || BUCKET_ROW_STYLES.notAssigned;
}

export function getBucketLabel(bucketKey) {
  return bucketKey ? BUCKET_LABELS[bucketKey] : NOT_ASSIGNED_LABEL;
}
