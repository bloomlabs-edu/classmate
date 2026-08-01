/**
 * services/ocrService.js
 *
 * Isolates OCR (image -> text) for the Curriculum Builder's Extract
 * Concepts stage. A teacher uploads photos/scans of textbook pages
 * (or a scanned PDF with no real text layer — see
 * pdfExtractionService.js's own renderPageToImageBlob(), which turns
 * such a page into an image this file can then OCR); nothing here
 * knows what a Curriculum, Unit, or ExtractionProvider is. This
 * mirrors pdfExtractionService.js's own single responsibility on
 * purpose — one file, one job, callers compose them.
 *
 * Tesseract.js is loaded lazily from jsDelivr (not cdnjs — cdnjs's own
 * listing for this library is stuck at a very old, unmaintained
 * 0.1.1; jsDelivr is where the project's own README points readers
 * for the current, maintained ESM build), the same lazy-CDN-import
 * shape pdfExtractionService.js already uses for pdf.js. This is a
 * genuinely new external dependency, not a cosmetic one — flagged
 * explicitly in this project's own Curriculum Builder design
 * discussion: there is no realistic self-hosted OCR engine, the same
 * reasoning this app already accepted for pdf.js itself.
 *
 * One worker is created once and reused across every image in a
 * session, never recreated per file — Tesseract.js's own
 * documentation is explicit that recognizing multiple images should
 * reuse one worker and call terminate() once at the end, not spin up
 * a fresh worker per image.
 *
 * Note: "Tesseract.js does not support PDF files" per the library's
 * own README — a PDF page must already be rendered to a plain image
 * (see pdfExtractionService.js's renderPageToImageBlob()) before this
 * file can do anything with it. This file only ever OCRs images.
 */

const TESSERACT_VERSION = '5'; // verified against github.com/naptha/tesseract.js's own README at the time this was written — re-check before assuming it's still current
const TESSERACT_ESM_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;

let tesseractLibPromise = null;

function loadTesseract() {
  if (!tesseractLibPromise) {
    tesseractLibPromise = import(/* webpackIgnore: true */ TESSERACT_ESM_URL);
  }
  return tesseractLibPromise;
}

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = loadTesseract().then((tesseractLib) => tesseractLib.createWorker('eng'));
  }
  return workerPromise;
}

/**
 * Extracts text from one image — a File/Blob (a photo or scan a
 * teacher uploaded) or a Blob produced by rendering a PDF page (see
 * pdfExtractionService.js). Reuses the same worker across every call
 * in a session; see terminateOcrWorker() for cleanup.
 */
export async function extractTextFromImage(imageFileOrBlob) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageFileOrBlob);
  return data.text;
}

/**
 * Shuts down the shared worker — call once a Concept Extraction
 * session is done (all uploaded files processed), not after every
 * individual image. Safe to call even if no worker was ever created.
 */
export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
