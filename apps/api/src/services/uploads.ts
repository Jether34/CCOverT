import crypto from 'node:crypto';
import path from 'node:path';
import type { UploadRecord } from '@ccovert/shared';
import { config } from '../config';
import { logger } from '../logger';
import { db, writeStoredFile, type UploadRecordStored } from '../repositories/database';
import { badRequest, notFound, payloadTooLarge, unsupportedMedia, unprocessable } from '../utils/errors';
import { extractPdfText } from './pdfText';

const allowedExtensions = new Set(['.pdf', '.txt', '.csv', '.json']);
const allowedMimeTypes = new Set(['application/pdf', 'text/plain', 'text/csv', 'application/json']);
const mimeByExtension: Record<string, string[]> = {
  '.pdf': ['application/pdf'], '.txt': ['text/plain'],
  '.csv': ['text/csv', 'text/plain'], '.json': ['application/json', 'text/plain']
};
const MAX_PREVIEW_CHARACTERS = 12000;

const safeFileName = (name: string): string => path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_');

/**
 * Files are validated, hashed, and written to a private directory that is never
 * served by the web server. Text-like files and simple PDFs get an extracted
 * preview so AI reports can cite them; a PDF whose font encoding cannot be read
 * is stored and reported as extraction-unsupported rather than guessed at.
 */
export async function storeUpload(file: Express.Multer.File, userId: string): Promise<UploadRecord> {
  if (!file?.buffer || file.size === 0) throw badRequest('Choose a non-empty file');
  if (file.size > config.uploads.maxBytes) {
    throw payloadTooLarge(`The file exceeds the ${Math.floor(config.uploads.maxBytes / 1024 / 1024)} MB limit`);
  }
  const filename = safeFileName(file.originalname);
  const extension = path.extname(filename).toLowerCase();
  if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype) || !mimeByExtension[extension]?.includes(file.mimetype)) {
    throw unsupportedMedia('Only PDF, TXT, CSV, and JSON files are accepted');
  }
  if (/\.(?:exe|js|jsx|ts|sh|bat|cmd|ps1|vbs)$/i.test(filename)) {
    throw unsupportedMedia('Executable and script files are not accepted');
  }

  const bytes = file.buffer;
  if (extension === '.pdf') {
    const header = bytes.subarray(0, 5).toString('ascii');
    const content = bytes.toString('latin1').toLowerCase();
    if (header !== '%PDF-' || content.includes('/javascript') || content.includes('/openaction') || content.includes('/launch')) {
      throw badRequest('The PDF contains unsupported active content');
    }
  } else if (bytes.includes(0)) {
    throw badRequest('The file contains unsupported binary content');
  }

  let textPreview: string | null = null;
  let extractionStatus: UploadRecord['extractionStatus'] = 'not-extracted';
  let pageCount: number | null = null;
  if (extension === '.pdf') {
    const extracted = extractPdfText(bytes);
    pageCount = extracted.pageCount;
    if (extracted.status === 'text-available' && extracted.text) {
      textPreview = extracted.text.slice(0, MAX_PREVIEW_CHARACTERS);
      extractionStatus = 'text-available';
    } else {
      // Reported honestly: an unsupported font encoding is never guessed at.
      extractionStatus = extracted.status === 'extraction-unsupported' ? 'extraction-unsupported' : 'not-extracted';
    }
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw badRequest('Text files must be UTF-8 encoded');
    }
    if (extension === '.json') {
      try {
        JSON.parse(text);
      } catch {
        throw badRequest('The JSON file is not valid JSON');
      }
    }
    textPreview = text.slice(0, MAX_PREVIEW_CHARACTERS);
    extractionStatus = 'text-available';
  }

  const storageKey = path.join(userId, `${crypto.randomUUID()}${extension}`);
  const id = crypto.randomUUID();
  const record: UploadRecordStored = {
    _id: id,
    id,
    userId,
    filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    uploadedAt: new Date().toISOString(),
    extractionStatus,
    textPreview,
    pageCount,
    storageKey
  };
  writeStoredFile(storageKey, bytes);
  await db.createUpload(record);
  logger.info('Stored a private user upload', { uploadId: record.id, userId, mimeType: record.mimeType, sizeBytes: record.sizeBytes });
  return record;
}

export async function listUploads(userId: string): Promise<UploadRecord[]> {
  const records = await db.listUploads(userId);
  return records.map(({ _id, userId: _userId, ...record }) => record);
}

export async function getUploadOrThrow(uploadId: string, userId: string): Promise<UploadRecordStored> {
  const record = await db.findUploadForUser(uploadId, userId);
  if (!record) throw notFound('No such upload for this account');
  return record;
}

export async function readUploadText(uploadId: string, userId: string): Promise<{ filename: string; text: string; pageCount: number | null }> {
  const record = await getUploadOrThrow(uploadId, userId);
  if (record.extractionStatus !== 'text-available' || !record.textPreview?.trim()) {
    throw unprocessable('This document has no verified extracted text. Upload a text-readable PDF or provide OCR text before requesting an AI report', 'DOCUMENT_TEXT_UNAVAILABLE');
  }
  if (record.textPreview) {
    return { filename: record.filename, text: record.textPreview, pageCount: record.pageCount };
  }
  throw unprocessable('The extracted document text is unavailable', 'DOCUMENT_TEXT_UNAVAILABLE');
}

export async function deleteUpload(uploadId: string, userId: string): Promise<void> {
  const deleted = await db.deleteUploadForUser(uploadId, userId);
  if (!deleted) throw notFound('No such upload for this account');
}
