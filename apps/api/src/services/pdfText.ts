import zlib from 'node:zlib';

/**
 * A deliberately small, dependency-free PDF text extractor.
 *
 * Scope and honesty rules:
 * - Only uncompressed and FlateDecode content streams are read, using the
 *   built-in zlib module. Anything else is reported as unsupported.
 * - Fonts with custom encodings (/Differences) or composite glyph mapping
 *   (/Type0, /Identity-H) are reported as unsupported instead of being decoded
 *   into wrong glyphs, because a wrong citation is worse than no citation.
 * - The result is a best-effort preview for report citations. It is never used
 *   as a model input and never presented as the authoritative file content.
 */
export interface PdfExtractionResult {
  status: 'text-available' | 'extraction-unsupported' | 'not-extracted';
  text: string | null;
  pageCount: number | null;
}

const MAX_STREAMS = 4000;
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 200_000;
const DICTIONARY_LOOKBEHIND = 2048;

/** Encodings whose glyphs cannot be mapped without an embedded font program. */
const UNSUPPORTED_ENCODING = /\/Subtype\s*\/Type0|\/Encoding\s*\/Identity-[HV]|\/Differences/;

const asLatin1 = (bytes: Buffer): string => bytes.toString('latin1');

const countPages = (raw: string): number => {
  const matches = raw.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  return matches ? matches.length : 0;
};

/** Reads the object dictionary that precedes a stream keyword. */
const dictionaryBefore = (raw: string, streamStart: number): string => {
  const from = Math.max(0, streamStart - DICTIONARY_LOOKBEHIND);
  return raw.slice(from, streamStart);
};

const inflate = (bytes: Buffer): Buffer | null => {
  try {
    return zlib.inflateSync(bytes, { maxOutputLength: MAX_INFLATED_BYTES });
  } catch {
    try {
      return zlib.inflateRawSync(bytes, { maxOutputLength: MAX_INFLATED_BYTES });
    } catch {
      return null;
    }
  }
};

const decodeHexString = (body: string): string => {
  const hex = body.replace(/[^0-9A-Fa-f]/g, '');
  if (hex.length === 0) return '';
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes = Buffer.from(padded, 'hex');
  // Some producers emit UTF-16BE text as a hex string.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return bytes.subarray(2).swap16().toString('utf16le');
  }
  return asLatin1(bytes);
};

const decodeLiteralString = (body: string): string => {
  const out: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== '\\') {
      out.push(body.charCodeAt(index) & 0xff);
      continue;
    }
    const next = body[index + 1];
    index += 1;
    switch (next) {
      case 'n': out.push(10); break;
      case 'r': out.push(13); break;
      case 't': out.push(9); break;
      case 'b': out.push(8); break;
      case 'f': out.push(12); break;
      case '(': out.push(40); break;
      case ')': out.push(41); break;
      case '\\': out.push(92); break;
      case undefined: out.push(92); break;
      default:
        if (next >= '0' && next <= '7') {
          const octal = body.slice(index, index + 3).match(/^[0-7]{1,3}/)?.[0] ?? next;
          out.push(parseInt(octal, 8) & 0xff);
          index += octal.length - 1;
        } else {
          out.push(next.charCodeAt(0) & 0xff);
        }
    }
  }
  return asLatin1(Buffer.from(out));
};

/** Splits a content stream into PDF tokens: strings, arrays, numbers, names, operators. */
const tokenize = (content: string): string[] => {
  const pattern = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|[-+]?(?:\d+\.?\d*|\.\d+)|\/[^\s/[\]<>(){}]+|[A-Za-z'"*]+/g;
  return content.match(pattern) ?? [];
};

/**
 * Pulls text out of the text-showing operators of one content stream. Line
 * breaks follow the positioning operators, and wide kerning gaps inside a TJ
 * array become spaces.
 */
const extractFromContentStream = (content: string): string => {
  const tokens = tokenize(content);
  const pieces: string[] = [];
  let pending: string[] = [];
  let pendingIsArray = false;
  let pendingBreak = false;
  let lastWasNumber = false;

  const pushSeparator = (separator: string): void => {
    if (pieces.length === 0 && separator === '\n') return;
    if (separator === ' ' && /\s$/.test(pieces[pieces.length - 1] ?? ' ')) return;
    pieces.push(separator);
  };

  const flush = (separator: string): void => {
    if (pending.length === 0) return;
    const text = pending.join(pendingIsArray ? '' : '');
    const atLineStart = pendingBreak;
    pending = [];
    pendingIsArray = false;
    pendingBreak = false;
    lastWasNumber = false;
    if (text.length === 0) return;
    pushSeparator(atLineStart ? '\n' : separator);
    pieces.push(text);
  };

  for (const token of tokens) {
    if (token.startsWith('(')) {
      pending.push(decodeLiteralString(token.slice(1, -1)));
      lastWasNumber = false;
      continue;
    }
    if (token.startsWith('<') && !token.startsWith('<<')) {
      pending.push(decodeHexString(token.slice(1, -1)));
      lastWasNumber = false;
      continue;
    }
    if (token === '[') {
      flush(' ');
      pendingIsArray = true;
      continue;
    }
    if (token === ']') {
      flush('');
      continue;
    }
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      // A large negative kerning value inside a TJ array is a word gap.
      if (pendingIsArray && lastWasNumber === false && Number(token) <= -120) pending.push(' ');
      lastWasNumber = true;
      continue;
    }
    switch (token) {
      case 'Tj':
      case 'TJ':
      case "'":
      case '"':
        flush('');
        break;
      case 'Td':
      case 'TD':
      case 'T*':
      case 'BT':
      case 'ET':
        if (pending.length > 0) flush('\n');
        else pendingBreak = true;
        break;
      default:
        break;
    }
  }
  flush('');
  return pieces.join('');
};

const normalise = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function extractPdfText(bytes: Buffer): PdfExtractionResult {
  const raw = asLatin1(bytes);
  const pageCount = countPages(raw);
  if (UNSUPPORTED_ENCODING.test(raw)) {
    return { status: 'extraction-unsupported', text: null, pageCount: pageCount > 0 ? pageCount : null };
  }

  const collected: string[] = [];
  let totalLength = 0;
  let streams = 0;
  let position = 0;

  while (streams < MAX_STREAMS && totalLength < MAX_TEXT_CHARACTERS) {
    const start = raw.indexOf('stream', position);
    if (start === -1) break;
    let dataStart = start + 'stream'.length;
    if (raw[dataStart] === '\r') dataStart += 1;
    if (raw[dataStart] === '\n') dataStart += 1;
    const end = raw.indexOf('endstream', dataStart);
    if (end === -1) break;
    streams += 1;
    position = end + 'endstream'.length;

    const dictionary = dictionaryBefore(raw, start);
    if (/\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/FontFile/.test(dictionary)) continue;

    let content: Buffer = Buffer.from(raw.slice(dataStart, end), 'latin1');
    if (/\/FlateDecode/.test(dictionary)) {
      const inflated = inflate(content);
      if (!inflated) continue;
      content = inflated;
    } else if (/\/(LZWDecode|RunLengthDecode|CCITTFaxDecode|DCTDecode|JPXDecode)/.test(dictionary)) {
      continue;
    }
    // The text operators are only visible after the stream has been decoded.
    const decoded = content.toString('latin1');
    if (!/BT[\s\S]{0,400}?ET|\bT[jJ]\b|\bT\*\b|'/.test(decoded)) continue;
    if (UNSUPPORTED_ENCODING.test(decoded)) {
      return { status: 'extraction-unsupported', text: null, pageCount: pageCount > 0 ? pageCount : null };
    }
    const text = extractFromContentStream(decoded);
    if (text.length > 0) {
      collected.push(text);
      totalLength += text.length;
    }
  }

  const text = normalise(collected.join('\n'));
  if (text.length === 0) {
    return { status: 'not-extracted', text: null, pageCount: pageCount > 0 ? pageCount : null };
  }
  return { status: 'text-available', text, pageCount: pageCount > 0 ? pageCount : null };
}
