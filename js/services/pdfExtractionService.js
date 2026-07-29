/**
 * services/pdfExtractionService.js
 *
 * Curriculum Import Pipeline redesign: this file owns exactly one
 * responsibility — turning an uploaded PDF File into text, for
 * whichever page range a caller actually needs right now. Nothing
 * here knows what a Table of Contents, a Unit, or a Concept is; it
 * doesn't parse anything, it just reads pages.
 *
 * The previous version of this capability always read a fixed first
 * 10 pages, because at the time nothing in the pipeline needed
 * anything else. This version generalizes to any page range, because
 * the redesigned pipeline genuinely needs two different things from
 * the same PDF at two different times:
 *   - Stage 3 (Table of Contents detection) needs the first ~10-15
 *     pages, once, up front.
 *   - Stage 6 (Concept Extraction) needs one Unit's own page range —
 *     re-extracted on demand, one Unit at a time, only once a teacher
 *     actually reaches that Unit's review step (see
 *     services/unitSegmentationService.js and this project's own
 *     "on demand, not eager" design decision — extracting all 23
 *     Units' text up front would waste real work if a teacher reviews
 *     Unit 1 and never comes back).
 *
 * Both of those calls need to read from the *same* uploaded file
 * without re-uploading or re-parsing it from scratch each time, which
 * is why loadPdfDocument() returns a handle the caller is expected to
 * hold onto for the lifetime of one Contribute Curriculum session
 * (see ui/views/CurriculumManagementView.js), passing it into
 * extractPageRange() as many times as needed, for whichever pages are
 * relevant at that moment.
 */

const PDFJS_VERSION = '6.1.200'; // verified against cdnjs.com/libraries/pdf.js at the time this was written — re-check before assuming it's still current
const PDFJS_BASE_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;

let pdfjsLibPromise = null;

function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(/* webpackIgnore: true */ `${PDFJS_BASE_URL}pdf.min.mjs`).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}pdf.worker.min.mjs`;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

/**
 * Opens an uploaded PDF File and returns a handle — a real pdf.js
 * document proxy, kept opaque to callers on purpose. Nothing outside
 * this file should reach into its internals; every other function
 * here takes this handle back in and returns plain data.
 *
 * `handle.numPages` is available immediately, at no extra read cost —
 * this is how a caller can know a book's real total length (e.g. to
 * resolve a last Unit's open-ended page range) without ever reading
 * every page.
 */
export async function loadPdfDocument(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

export function getTotalPageCount(pdfHandle) {
  return pdfHandle.numPages;
}

/**
 * Extracts real, line-reconstructed text for exactly the given page
 * range (inclusive on both ends), from an already-open handle — no
 * re-reading of pages outside this range, whether this is the first
 * 12 pages (Table of Contents detection) or pages 22-34 (one Unit's
 * own content, re-extracted only once a teacher reaches it).
 *
 * pdf.js's getTextContent() returns a flat list of text fragments per
 * page with no line breaks of its own — line structure has to be
 * reconstructed from each fragment's vertical position
 * (`item.transform[5]`, its Y-coordinate on the page). Verified
 * against a real TN Samacheer Kalvi Grade 8 Science PDF's actual
 * heading and Table of Contents shape — genuinely unverified beyond
 * that, though, since this sandbox has no browser or pdf.js to run
 * this file's *upload* half against directly. Test this specific
 * function against a real PDF in an actual browser before assuming
 * it's fully correct.
 *
 * Returns `{ pageTexts, fullText }` — `pageTexts` has one entry per
 * page in the requested range, in order; `fullText` is every page
 * joined by a blank line (so a heading sitting at the very top of a
 * new page doesn't visually run into the previous page's last line).
 */
export async function extractPageRange(pdfHandle, startPage, endPage) {
  const firstPage = Math.max(1, startPage);
  const lastPage = Math.min(pdfHandle.numPages, endPage);

  const pageTexts = [];
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber++) {
    const page = await pdfHandle.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(reconstructLinesFromTextItems(content.items));
  }

  return { pageTexts, fullText: pageTexts.join('\n\n') };
}

// A new line, in a PDF's own coordinate space, is a fragment whose Y
// position differs meaningfully from the fragment before it — not
// zero difference, since ordinary kerning/rendering can produce tiny
// sub-pixel variance even within one visual line. 2pt is a
// deliberately small, conservative threshold: real line spacing in a
// printed textbook is many times that, while numerals and general
// body text won't drift on their own that much within one line.
const NEW_LINE_Y_THRESHOLD = 2;

function reconstructLinesFromTextItems(items) {
  let text = '';
  let lastY = null;

  for (const item of items) {
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    const isNewLine = lastY !== null && y !== null && Math.abs(y - lastY) > NEW_LINE_Y_THRESHOLD;

    if (isNewLine) {
      text += '\n';
    } else if (text && !text.endsWith('\n')) {
      text += ' ';
    }

    text += item.str;
    if (y !== null) lastY = y;
  }

  return text;
}
