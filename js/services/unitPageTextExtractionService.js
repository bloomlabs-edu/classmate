/**
 * services/unitPageTextExtractionService.js
 *
 * Orchestrates "Upload textbook pages -> OCR -> plain text" for the
 * Curriculum Builder's Extract Concepts stage — the one thing this
 * file knows how to do is turn a list of uploaded files (PDF, PNG,
 * JPG, JPEG) into the plain text an ExtractionProvider's buildPrompt()
 * needs (see services/extractionProviders/manualAiProvider.js). It
 * has no idea what a Curriculum, Unit, or ExtractionProvider is —
 * same single-responsibility shape as
 * services/pdfExtractionService.js and services/ocrService.js, which
 * this file composes rather than duplicates.
 *
 * Per PDF file: real, embedded text is tried first (see
 * pdfExtractionService.js's extractPageRange(), reused as-is — most
 * textbook PDFs already have this, and it's both faster and more
 * accurate than OCR when available). Only falls back to rendering
 * each page as an image and OCRing it (see
 * pdfExtractionService.js's renderPageToImageBlob(),
 * services/ocrService.js's extractTextFromImage()) when a PDF has
 * little to no real text — Tesseract.js's own README states plainly
 * it "does not support PDF files" at all, so this fallback isn't
 * optional for a scanned PDF, it's the only way to get any text out
 * of one.
 *
 * Per image file (PNG/JPG/JPEG): OCR directly — there is no "text
 * layer" concept for a plain photo or scan.
 *
 * Multiple files are processed in order and joined the same way
 * pdfExtractionService.js already joins multi-page text (a blank line
 * between each), so a heading at the top of one file's content never
 * visually runs into the previous file's last line.
 *
 * The one heuristic in this file: whether a PDF's own extracted text
 * is "real" or should be treated as absent. Fewer than
 * MIN_CHARS_PER_PAGE characters per page, averaged across the whole
 * file, is treated as "no real text layer" — a deliberately
 * conservative threshold (a page with a single stray character or two
 * from a rendering artifact shouldn't count as having real text, but
 * a page with even a sparse but genuine sentence should).
 */

import * as pdfExtractionService from './pdfExtractionService.js';
import * as ocrService from './ocrService.js';

const MIN_CHARS_PER_PAGE = 20;

/** Whether a File is a PDF — by MIME type first, falling back to the filename extension for a browser that didn't set the type correctly (a real, observed inconsistency for some file pickers/OSes). */
export function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

/**
 * The one heuristic in this file, isolated as a pure function so it
 * can be verified directly: is `fullText` real, substantive extracted
 * text, or should a PDF with this little text be treated as having no
 * real text layer at all (i.e. scanned, needing OCR instead)?
 * Deliberately conservative — a page with a single stray character or
 * two from a rendering artifact shouldn't count as "has real text,"
 * but a page with even a sparse but genuine sentence should.
 */
export function hasRealTextLayer(fullText, totalPages) {
  return (fullText || '').trim().length >= MIN_CHARS_PER_PAGE * totalPages;
}

/**
 * Extracts plain text from one PDF file — real text if the PDF has
 * it, OCR (page by page) if it doesn't.
 */
async function extractTextFromPdfFile(file) {
  const pdfHandle = await pdfExtractionService.loadPdfDocument(file);
  const totalPages = pdfExtractionService.getTotalPageCount(pdfHandle);

  const { fullText } = await pdfExtractionService.extractPageRange(pdfHandle, 1, totalPages);
  if (hasRealTextLayer(fullText, totalPages)) return fullText;

  // No real text layer — render each page as an image and OCR it.
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const imageBlob = await pdfExtractionService.renderPageToImageBlob(pdfHandle, pageNumber);
    const pageText = await ocrService.extractTextFromImage(imageBlob);
    pageTexts.push(pageText);
  }
  return pageTexts.join('\n\n');
}

/**
 * The one entry point this file exposes. `files` is a FileList/array
 * of File objects (PDF, PNG, JPG, JPEG — see
 * ui/components/FileDropZone.js for where these come from). Returns
 * the combined plain text of every file, in the order given.
 *
 * `onProgress`, if provided, is called with `{ fileIndex, fileName,
 * totalFiles }` before each file starts processing — this is a
 * genuinely slow, multi-second-per-page operation for OCR
 * specifically, and a teacher uploading several pages needs to see
 * real progress, not a single opaque spinner for however long the
 * whole batch takes.
 */
export async function extractTextFromFiles(files, { onProgress } = {}) {
  const fileArray = Array.from(files);
  const texts = [];

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    if (onProgress) onProgress({ fileIndex: i, fileName: file.name, totalFiles: fileArray.length });

    const text = isPdfFile(file) ? await extractTextFromPdfFile(file) : await ocrService.extractTextFromImage(file);
    texts.push(text);
  }

  return texts.join('\n\n');
}
