/**
 * config/appConfig.js
 *
 * General, app-wide configuration.
 *
 * Classroom data lives in Firestore (see
 * repositories/firestoreClassroomRepository.js), not localStorage.
 * LEGACY_STORAGE_KEY is kept only so services/workspaceService.js can
 * find and migrate any classrooms saved locally by an earlier version
 * of this app — new data is never written here. The migration itself is
 * guarded by a Firestore transaction (repository.claimMigration), not a
 * localStorage flag, so it stays account-scoped rather than
 * device-scoped even for this local-data case. Deliberately left as
 * "classroom-tracker" even after the ClassMate rebrand — this is a
 * historical key describing what old, already-saved data was actually
 * written under, not a current branding string; changing it would
 * simply stop the migration from finding that data at all.
 */

export const LEGACY_STORAGE_KEY = 'classroom-tracker:workspace';

export const APP_CONFIG = Object.freeze({
  storageKeyPrefix: 'classroom-tracker',
  defaultLocale: 'en-IN',
});

/**
 * The single source of truth for ClassMate's own public URL — every
 * place that builds a shareable link (WhatsApp invitations, the
 * Student Portal link, a future QR code, etc.) should read this
 * constant rather than constructing one inline. Computed from
 * window.location by default, so it's already correct with zero setup
 * in every environment this app actually runs in today — local dev,
 * GitHub Pages, or any future custom domain — without needing to be
 * manually kept in sync with wherever it's currently deployed.
 *
 * If ClassMate ever moves to a stable custom domain and every
 * environment (including local development) should generate links
 * pointing at that one production URL regardless of where the code is
 * actually running, replace the line below with a fixed string, e.g.:
 *   export const APP_BASE_URL = 'https://classmate.app/';
 * That's the one edit this constant exists to make possible — nothing
 * else in the app needs to change.
 */
export const APP_BASE_URL = `${window.location.origin}${window.location.pathname}`;
