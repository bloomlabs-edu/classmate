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
export const BUCKET_ROW_STYLES = Object.freeze({
  green: { background: '#EAF7EC', border: '#2e7d32', text: '#1a1a1a' },
  yellow: { background: '#FFF8E1', border: '#b7791f', text: '#1a1a1a' },
  red: { background: '#FDECEA', border: '#c62828', text: '#1a1a1a' },
  notAssigned: { background: '#F3F4F6', border: '#9AA5B1', text: '#1a1a1a' },
});

export function getBucketRowStyle(bucketKey) {
  return BUCKET_ROW_STYLES[bucketKey] || BUCKET_ROW_STYLES.notAssigned;
}

export function getBucketLabel(bucketKey) {
  return bucketKey ? BUCKET_LABELS[bucketKey] : NOT_ASSIGNED_LABEL;
}
