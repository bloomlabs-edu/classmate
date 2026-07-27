/**
 * utils/idGenerator.js
 *
 * Generates unique identifiers for new records (students, teams, events)
 * before they're persisted.
 */

export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * A short, human-shareable classroom join code — deliberately not a
 * UUID (models/Classroom.js's `id`), since that's meant to be read
 * aloud or typed by a co-teacher joining a classroom, not just stored.
 * 6 characters, uppercase, excludes visually ambiguous characters
 * (0/O, 1/I/L) so it's easy to say and type correctly.
 */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

export function generateJoinCode() {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * A short numeric PIN a teacher reads aloud to approve adding or
 * removing a student profile on an already-claimed device (see
 * services/studentDeviceService.js's trusted-device model). Numeric
 * and short deliberately — this gets typed on a phone's number pad in
 * front of the class, not copy-pasted, so it should be quick to say
 * and quick to enter. Not a security boundary against a determined
 * attacker; a low-friction "the teacher was actually asked" gate.
 */
const DEVICE_RESET_PIN_LENGTH = 4;

export function generateDeviceResetPin() {
  let pin = '';
  for (let i = 0; i < DEVICE_RESET_PIN_LENGTH; i++) {
    pin += Math.floor(Math.random() * 10);
  }
  return pin;
}
