import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

// Set up local worker via Vite URL loader
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// anydoc (firecrawl/anydoc, harvested 2026-08-12) does real structural
// parsing — actual headings/tables/lists, not the flattened text pdfjs-dist
// and mammoth.extractRawText() produce below — plus native support for
// formats (xlsx, pptx, csv, epub, rtf, odt, doc, ppt) the old path never
// handled at all. It's a native Rust addon, so it only runs in Electron's
// main process; parseDocumentFile calls it over IPC when available and
// falls back to the old renderer-side parsers otherwise (e.g. `vite
// preview` opened directly in a browser, or tests).
const ANYDOC_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'epub',
  'pptx', 'ppt', 'xlsx', 'xls', 'ods', 'csv'
]);

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'tiff'
]);

export async function parseDocumentFile(file) {
  const fileType = file.name.split('.').pop().toLowerCase();

  if (IMAGE_EXTENSIONS.has(fileType)) {
    throw new Error('Image file detected. Use image attachment instead of document parser.');
  }

  if (window.electronAPI?.parseDocument && ANYDOC_EXTENSIONS.has(fileType)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await window.electronAPI.parseDocument(bytes, file.name);
    if (result.success) return result.markdown;
    return `[Document Conversion Error: ${result.error}]`;
  }

  if (fileType === 'pdf') {
    return await parsePDF(file);
  } else if (fileType === 'docx') {
    return await parseDocx(file);
  } else {
    return await parseTextFile(file);
  }
}

function parseTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

async function parsePDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      useSystemFonts: true
    });

    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `--- Page ${pageNum} ---\n${pageText}\n\n`;
    }

    return fullText;
  } catch (err) {
    console.error('Error parsing PDF:', err);
    return `[PDF Text Extraction Error: ${err.message}]`;
  }
}

async function parseDocx(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (err) {
    console.error('Error parsing DOCX:', err);
    return `[DOCX Text Extraction Error: ${err.message}]`;
  }
}
