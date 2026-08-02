/**
 * services/assessmentImportService.js
 *
 * Assessment Import — Phase 1. Owns exactly the parts of import that
 * are genuinely new: reading a spreadsheet into plain rows, matching
 * those rows against this classroom's real roster and this
 * Assessment's own Subjects, and building a review summary. It does
 * NOT own persistence — the actual save is
 * services/assessmentService.js's saveAssessmentSubjectDraft(), the
 * exact same function manual entry (see
 * ui/views/AssessmentManagementView.js's own renderSubjectStep()) already
 * uses. Import is a different way to arrive at the same draft shape a
 * teacher would build by hand, not a second, parallel persistence
 * path — every statistic, publish action, and student notification
 * this app already has for a manually-entered mark works identically
 * for an imported one, because it IS the same data going through the
 * same save.
 *
 * Deliberately excludes, per this milestone's own explicit scope: AI
 * interpretation, OCR, PDF import, Google Sheets, and a drag-and-drop
 * column-mapping UI. Column matching here is a small, deterministic
 * normalization heuristic — not a model call — and anything it can't
 * confidently resolve is surfaced to the teacher to decide, not
 * guessed at silently.
 */

import * as assessmentService from './assessmentService.js';

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'; // verified against docs.sheetjs.com's own Standalone Browser Scripts guide at the time this was written — re-check before assuming it's still current, the same caveat services/pdfExtractionService.js's own PDF.js version carries

let sheetJsPromise = null;
function loadSheetJs() {
  if (!sheetJsPromise) {
    sheetJsPromise = import(/* webpackIgnore: true */ SHEETJS_URL);
  }
  return sheetJsPromise;
}

/** Column headers that identify a student, never a Subject's marks — matched case-insensitively, trimmed. Everything else in a row is treated as a possible Subject column. */
const STUDENT_IDENTITY_HEADERS = ['student', 'student name', 'name'];
const ROLL_NUMBER_HEADERS = ['roll no', 'roll no.', 'roll number', 'rollno', 'roll'];

/**
 * Reads an uploaded .xlsx or .csv File into plain rows — an array of
 * objects keyed by column header, in whatever order the file itself
 * has them. Makes no assumption about column order or which columns
 * exist beyond needing at least one recognizable student-identity
 * column (see STUDENT_IDENTITY_HEADERS/ROLL_NUMBER_HEADERS above) —
 * everything else is treated as data by matchSubjectColumns() below,
 * not by this function.
 *
 * Writes nothing anywhere; this is a pure read.
 */
export async function parseSpreadsheetFile(file) {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  return isCsv ? parseCsvFile(file) : parseXlsxFile(file);
}

async function parseXlsxFile(file) {
  const XLSX = await loadSheetJs();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  // defval: '' -- a genuinely blank cell becomes an empty string, not
  // an absent key. Missing marks are a required, expected case here
  // (see this module's own header comment), not an error to guard
  // against; every row needs every column present, even empty, so
  // downstream matching can tell "blank" apart from "column doesn't
  // exist in this file at all."
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

async function parseCsvFile(file) {
  const text = await file.text();
  const rows = parseCsvText(text);
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => cell.trim() !== '')) // skip genuinely blank trailing lines
    .map((row) => {
      const record = {};
      headerRow.forEach((header, index) => {
        record[header] = row[index] ?? '';
      });
      return record;
    });
}

/**
 * A small, dependency-free CSV parser — handles quoted fields
 * (including a comma or an escaped "" inside quotes) since a real
 * spreadsheet export can contain either. Returns rows as arrays of
 * plain strings; parseCsvFile() above is what turns that into
 * header-keyed records.
 */
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++; // consume \r\n as one line break
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(header) {
  return String(header).trim().toLowerCase();
}

/**
 * Splits a parsed row's own keys into: which one column identifies
 * the student by name, which one (if any) gives a roll number, and
 * every remaining column — the candidate Subject columns, matched
 * separately by matchSubjectColumns() below.
 */
function identifyRowColumns(rows) {
  if (rows.length === 0) return { nameColumn: null, rollNumberColumn: null, otherColumns: [] };

  const columns = Object.keys(rows[0]);
  const nameColumn = columns.find((col) => STUDENT_IDENTITY_HEADERS.includes(normalizeHeader(col))) || null;
  const rollNumberColumn = columns.find((col) => ROLL_NUMBER_HEADERS.includes(normalizeHeader(col))) || null;
  const otherColumns = columns.filter((col) => col !== nameColumn && col !== rollNumberColumn);

  return { nameColumn, rollNumberColumn, otherColumns };
}

/**
 * Matches every parsed row against this classroom's real roster.
 * Priority, per explicit spec: Roll Number first, then Student Name —
 * never the reverse, since a roll number is a more reliable identity
 * than a name (which can collide, or be entered with different
 * capitalization/spacing). A row that matches neither goes to
 * `unmatchedRows`, never silently dropped and never guessed at.
 *
 * Name matching is case-insensitive and trims whitespace, but is
 * otherwise exact — this milestone doesn't attempt fuzzy name
 * matching (e.g. nicknames, transliteration variants), which would be
 * a much larger, separate piece of work than "normalize obvious
 * variations" was ever meant to cover for subject columns, let alone
 * student identity.
 */
export function matchStudents(rows, students) {
  const { nameColumn, rollNumberColumn, otherColumns } = identifyRowColumns(rows);

  const studentsByRollNumber = new Map(
    students.filter((s) => s.rollNumber != null && s.rollNumber !== '').map((s) => [String(s.rollNumber).trim(), s])
  );
  const studentsByName = new Map(students.map((s) => [s.name.trim().toLowerCase(), s]));

  const matchedRows = [];
  const unmatchedRows = [];

  rows.forEach((row) => {
    const rollNumberValue = rollNumberColumn ? String(row[rollNumberColumn] ?? '').trim() : '';
    const nameValue = nameColumn ? String(row[nameColumn] ?? '').trim() : '';

    let student = null;
    if (rollNumberValue) {
      student = studentsByRollNumber.get(rollNumberValue) || null;
    }
    if (!student && nameValue) {
      student = studentsByName.get(nameValue.toLowerCase()) || null;
    }

    if (student) {
      matchedRows.push({ row, student });
    } else {
      unmatchedRows.push({ row, displayName: nameValue || rollNumberValue || '(unidentified row)' });
    }
  });

  return { matchedRows, unmatchedRows, subjectColumns: otherColumns };
}

/**
 * Matches each remaining spreadsheet column against this Assessment's
 * own Subjects (resolved to their current titles, the same way
 * ui/views/AssessmentManagementView.js already does via
 * assessmentService.getSubjectTitle() — never a copy taken at import
 * time). A small, deterministic normalization: exact match (trimmed,
 * case-insensitive) or one string being a prefix of the other
 * ("Social" -> "Social Science") counts as high confidence; anything
 * else is returned as unmatched for the teacher to resolve manually
 * before import can proceed — never guessed at silently, per explicit
 * "if confidence is low, ask the teacher" instruction. No AI call
 * here at all, by explicit scope.
 */
export function matchSubjectColumns(subjectColumns, assessmentSubjects, classroom) {
  const subjectsWithTitles = assessmentSubjects.map((assessmentSubject) => ({
    assessmentSubject,
    title: assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId),
  }));

  const matches = [];
  const unmatchedColumns = [];

  subjectColumns.forEach((column) => {
    const normalizedColumn = normalizeHeader(column);
    const found = subjectsWithTitles.find(({ title }) => {
      if (!title) return false;
      const normalizedTitle = normalizeHeader(title);
      return normalizedTitle === normalizedColumn || normalizedTitle.startsWith(normalizedColumn) || normalizedColumn.startsWith(normalizedTitle);
    });

    if (found) {
      matches.push({ column, assessmentSubject: found.assessmentSubject, subjectTitle: found.title });
    } else {
      unmatchedColumns.push(column);
    }
  });

  return { matches, unmatchedColumns };
}

/**
 * Builds the Review screen's own summary — matched student count,
 * per-Subject marks-present/missing counts, and the unmatched list —
 * entirely from data already computed by matchStudents()/
 * matchSubjectColumns() above. Pure computation, no side effects.
 */
export function buildImportSummary({ matchedRows, unmatchedRows, subjectMatches }) {
  const perSubject = subjectMatches.map(({ column, assessmentSubject, subjectTitle }) => {
    let withMarks = 0;
    let missing = 0;
    matchedRows.forEach(({ row }) => {
      const cellValue = String(row[column] ?? '').trim();
      if (cellValue === '') missing++;
      else withMarks++;
    });
    return { assessmentSubjectId: assessmentSubject.id, subjectTitle, withMarks, missing };
  });

  return {
    studentsMatchedCount: matchedRows.length,
    unmatchedCount: unmatchedRows.length,
    perSubject,
  };
}

/**
 * Applies the import — for every matched Subject column, builds
 * exactly the same `draft` shape
 * ui/views/AssessmentManagementView.js's own manual-entry editor
 * builds ({ maximumMarks, resultsByStudentId }), then calls
 * assessmentService.saveAssessmentSubjectDraft() — the exact same
 * function manual entry calls. This is the one place import and
 * manual entry genuinely converge; nothing downstream of this call
 * can tell an imported mark apart from a typed one, which is the
 * entire point.
 *
 * A blank cell for an already-matched student is handled carefully,
 * not naively: if that student has no existing StudentResult for this
 * Subject at all, one is created with `marks: null` ("store the
 * student result with no score yet," per explicit spec). If a result
 * already exists (e.g. a teacher had already typed something in, or a
 * previous import already set it), a blank cell in *this* import
 * leaves it completely untouched rather than overwriting a real value
 * with nothing just because this particular file happened to omit it
 * — reimporting a partial spreadsheet should never silently erase
 * marks a teacher already trusts are correct.
 *
 * Does not call workspaceService.save() itself — matches this app's
 * own established convention (see assessmentService.js's own header
 * comment) of mutating in memory and leaving the actual persistence
 * call to the caller (see ui/views/AssessmentManagementView.js).
 */
export function applyImport(classroom, { matchedRows, subjectMatches }) {
  subjectMatches.forEach(({ column, assessmentSubject }) => {
    const resultsByStudentId = new Map();

    matchedRows.forEach(({ row, student }) => {
      const cellValue = String(row[column] ?? '').trim();
      const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);

      if (cellValue === '') {
        if (!existingResult) {
          resultsByStudentId.set(student.id, { marks: null, absent: false, remarks: '' });
        }
        // else: leave an existing result completely alone -- see this
        // function's own header comment for why.
        return;
      }

      const parsedMarks = Number(cellValue);
      if (!Number.isFinite(parsedMarks)) return; // a non-numeric cell (e.g. "Absent") isn't this milestone's concern -- skip rather than guess

      resultsByStudentId.set(student.id, {
        marks: parsedMarks,
        absent: existingResult ? existingResult.absent : false,
        remarks: existingResult ? existingResult.remarks : '',
      });
    });

    if (resultsByStudentId.size === 0) return; // nothing to change for this Subject

    assessmentService.saveAssessmentSubjectDraft(assessmentSubject, {
      maximumMarks: assessmentSubject.maximumMarks, // import never changes maximum marks -- only manual entry does
      resultsByStudentId,
    });
  });
}
