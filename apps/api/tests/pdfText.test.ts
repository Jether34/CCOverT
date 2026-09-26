import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../src/services/pdfText';

const buildPdf = (options: { content: string; compress?: boolean; fontDictionary?: string; pages?: number }): Buffer => {
  const content = options.content;
  const body = options.compress ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const streamDictionary = options.compress ? '<< /Length ' + body.length + ' /Filter /FlateDecode >>' : '<< /Length ' + body.length + ' >>';
  const pageCount = options.pages ?? 1;
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_value, index) => `${3 + index} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Count ${pageCount} /Kids [${pageIds}] >>`);
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${3 + pageCount} 0 R >>`);
  }
  objects.push(`${streamDictionary}\nstream\n`);
  const head = objects.join('\n');
  const parts = [Buffer.from(`%PDF-1.7\n${head}`, 'latin1'), body, Buffer.from('\nendstream\nendobj\n', 'latin1')];
  if (options.fontDictionary) parts.push(Buffer.from(options.fontDictionary, 'latin1'));
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
};

const simpleContent = 'BT /F1 12 Tf 72 720 Td (Coral cover over time) Tj 0 -14 Td [(Puerto Princesa) -300 (Palawan)] TJ ET';

describe('extractPdfText', () => {
  it('reads text from an uncompressed content stream', () => {
    const result = extractPdfText(buildPdf({ content: simpleContent }));
    expect(result.status).toBe('text-available');
    expect(result.text).toContain('Coral cover over time');
    expect(result.text).toContain('Puerto Princesa');
    expect(result.text).toContain('Palawan');
    expect(result.pageCount).toBe(1);
  });

  it('reads text from a FlateDecode content stream', () => {
    const result = extractPdfText(buildPdf({ content: simpleContent, compress: true }));
    expect(result.status).toBe('text-available');
    expect(result.text).toContain('Coral cover over time');
  });

  it('counts pages and keeps line structure', () => {
    const result = extractPdfText(buildPdf({ content: simpleContent, pages: 3 }));
    expect(result.pageCount).toBe(3);
    expect(result.text?.split('\n').length).toBeGreaterThan(1);
  });

  it('decodes escapes in literal strings and normalises whitespace', () => {
    const result = extractPdfText(buildPdf({ content: 'BT (Tab\\there) Tj (100\\% cover) Tj ET' }));
    expect(result.status).toBe('text-available');
    // Control characters are normalised to single spaces in the preview.
    expect(result.text).toContain('Tab here');
    expect(result.text).toContain('100% cover');
  });

  it('refuses to guess text from a composite font encoding', () => {
    const pdf = buildPdf({
      content: simpleContent,
      fontDictionary: '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+NotoSans /Encoding /Identity-H >>'
    });
    const result = extractPdfText(pdf);
    expect(result.status).toBe('extraction-unsupported');
    expect(result.text).toBeNull();
  });

  it('refuses to guess text from a Differences encoding', () => {
    const pdf = buildPdf({
      content: simpleContent,
      fontDictionary: '<< /Type /Font /Subtype /TrueType /Encoding << /Differences [65 /alpha] >> >>'
    });
    expect(extractPdfText(pdf).status).toBe('extraction-unsupported');
  });

  it('reports not-extracted when a stream carries no text operators', () => {
    const result = extractPdfText(buildPdf({ content: 'q 1 0 0 1 0 0 cm 100 100 m 200 200 l S Q' }));
    expect(result.status).toBe('not-extracted');
    expect(result.text).toBeNull();
  });

  it('does not throw on a corrupt or truncated stream', () => {
    const truncated = Buffer.concat([Buffer.from('%PDF-1.7\n<< /Length 999 /Filter /FlateDecode >>\nstream\n', 'latin1'), Buffer.from([0x78, 0x9c, 0xff, 0xfe])]);
    expect(() => extractPdfText(truncated)).not.toThrow();
    expect(extractPdfText(truncated).status).toBe('not-extracted');
  });
});
