// Reading just enough of a file in the browser to reject it before it is sent.
//
// The XLSX reader here is deliberately minimal: an .xlsx is a ZIP of XML, and
// unzipping the handful of entries we need with DecompressionStream is smaller
// than adding a spreadsheet dependency for one question — "does this workbook
// have any rows in it?". Extracted from the old FileUpload component, which
// used it for the same check.

import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
} from '../config/upload';

export function getFileExtension(fileName) {
  const parts = String(fileName ?? '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

export function formatFileSize(bytes) {
  if (bytes == null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---- Minimal XLSX reader ----------------------------------------------------

function getCellColumnIndex(cellRef = '') {
  const match = cellRef.match(/[A-Z]+/i);
  if (!match) return -1;

  const letters = match[0].toUpperCase();
  let value = 0;

  for (let i = 0; i < letters.length; i += 1) {
    value = value * 26 + (letters.charCodeAt(i) - 64);
  }

  return value - 1;
}

async function inflateDeflateRaw(compressedData) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser does not support XLSX decompression.');
  }

  const stream = new Blob([compressedData])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const decompressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressed);
}

async function decodeZipEntry(entry) {
  if (entry.compressionMethod === 0) return entry.compressedData;
  if (entry.compressionMethod === 8) return inflateDeflateRaw(entry.compressedData);
  throw new Error(`Unsupported XLSX compression method: ${entry.compressionMethod}`);
}

function parseZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const flags = view.getUint16(offset + 6, true);
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const fileName = decoder.decode(bytes.slice(nameStart, nameEnd));

    const dataStart = nameEnd + extraLength;

    // Sizes live in a trailing data descriptor rather than the header, so the
    // entry can't be located from here. Stop rather than guess.
    if ((flags & 0x0008) !== 0) break;

    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) break;

    entries.set(fileName, {
      fileName,
      compressionMethod,
      compressedData: bytes.slice(dataStart, dataEnd),
    });

    offset = dataEnd;
  }

  return entries;
}

function parseSharedStrings(sharedStringsXml) {
  const doc = new DOMParser().parseFromString(sharedStringsXml, 'application/xml');

  return Array.from(doc.getElementsByTagName('si')).map((siNode) => {
    const tNodes = Array.from(siNode.getElementsByTagName('t'));
    return tNodes.map((tNode) => tNode.textContent || '').join('');
  });
}

function parseWorksheetRows(worksheetXml, sharedStrings, maxRows, maxCols) {
  const doc = new DOMParser().parseFromString(worksheetXml, 'application/xml');
  const rowNodes = Array.from(doc.getElementsByTagName('row')).slice(0, maxRows);

  return rowNodes.map((rowNode) => {
    const rowValues = new Array(maxCols).fill('');

    Array.from(rowNode.getElementsByTagName('c')).forEach((cellNode) => {
      const colIndex = getCellColumnIndex(cellNode.getAttribute('r') || '');
      if (colIndex < 0 || colIndex >= maxCols) return;

      const type = cellNode.getAttribute('t');
      const valueNode = cellNode.getElementsByTagName('v')[0];

      if (!valueNode) {
        rowValues[colIndex] = cellNode.getElementsByTagName('t')[0]?.textContent || '';
        return;
      }

      const rawValue = valueNode.textContent || '';
      rowValues[colIndex] =
        type === 's' ? sharedStrings[Number.parseInt(rawValue, 10)] || '' : rawValue;
    });

    return rowValues;
  });
}

async function readXlsxRows(file, maxRows = 10, maxCols = 5) {
  const entries = parseZipEntries(await file.arrayBuffer());
  const decoder = new TextDecoder('utf-8');

  const workbookEntry = entries.get('xl/workbook.xml');
  if (!workbookEntry) return { sheetNames: [], rows: [] };

  const workbookXml = decoder.decode(await decodeZipEntry(workbookEntry));
  const workbookDoc = new DOMParser().parseFromString(workbookXml, 'application/xml');
  const sheetNodes = Array.from(workbookDoc.getElementsByTagName('sheet'));
  const sheetNames = sheetNodes.map((node) => node.getAttribute('name') || '').filter(Boolean);

  const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
  const relsMap = new Map();

  if (relsEntry) {
    const relsXml = decoder.decode(await decodeZipEntry(relsEntry));
    const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    Array.from(relsDoc.getElementsByTagName('Relationship')).forEach((relNode) => {
      const id = relNode.getAttribute('Id');
      const target = relNode.getAttribute('Target');
      if (id && target) relsMap.set(id, target);
    });
  }

  const firstSheetRelId = sheetNodes[0]?.getAttribute('r:id');
  const firstSheetTarget = firstSheetRelId ? relsMap.get(firstSheetRelId) : null;
  if (!firstSheetTarget) return { sheetNames, rows: [] };

  const normalizedTarget = firstSheetTarget.startsWith('/')
    ? firstSheetTarget.slice(1)
    : `xl/${firstSheetTarget.replace(/^\.\//, '')}`;

  const sheetEntry = entries.get(normalizedTarget);
  if (!sheetEntry) return { sheetNames, rows: [] };

  const sharedStringsEntry = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(decoder.decode(await decodeZipEntry(sharedStringsEntry)))
    : [];

  const sheetXml = decoder.decode(await decodeZipEntry(sheetEntry));
  return { sheetNames, rows: parseWorksheetRows(sheetXml, sharedStrings, maxRows, maxCols) };
}

// ---- Validation -------------------------------------------------------------

/**
 * Check one file against the upload rules, in the order a person would:
 * the wrong kind of file, then too big, then nothing in it.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }` — one specific reason, not
 * a list, because the file row shows exactly one.
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function validateFile(file) {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      reason: `Unsupported format .${extension || '?'} — use ${ALLOWED_EXTENSIONS
        .map((ext) => `.${ext}`)
        .join(', ')}`,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: `Too large at ${formatFileSize(file.size)} — the limit is ${MAX_FILE_SIZE_MB} MB`,
    };
  }

  if (file.size === 0) {
    return { ok: false, reason: 'File is empty' };
  }

  if (extension === 'txt' || extension === 'csv') {
    const text = await file.text();
    if (!text.trim()) return { ok: false, reason: 'File has no content' };
    return { ok: true };
  }

  if (extension === 'xlsx') {
    try {
      const { sheetNames, rows } = await readXlsxRows(file);
      const hasData = rows.some((row) => row.some((cell) => String(cell || '').trim()));
      if (!sheetNames.length || !hasData) {
        return { ok: false, reason: 'Workbook has no data in its first sheet' };
      }
    } catch {
      // An unreadable workbook is not necessarily an invalid one — this reader
      // handles a subset of the format. The server reads it properly; let it.
      return { ok: true };
    }
  }

  return { ok: true };
}
