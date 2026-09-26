import ExcelJS from 'exceljs';
import type { DatasetKind } from '@ccovert/shared';
import { badRequest } from '../utils/errors';
import { parseCsv } from './datasets';

const kinds: DatasetKind[] = ['sst', 'tourism', 'coral-cover'];
const unitFor = (kind: DatasetKind): string => kind === 'sst' ? 'degC' : kind === 'tourism' ? 'annualArrivals' : 'percent';

export interface WorkbookSeries {
  kind: DatasetKind;
  label: string;
  provider: string;
  sourceCitation: string;
  unit: string;
  scope: 'citywide-annual-average' | 'reef-site';
  spatialCoverage: string;
  text: string;
}

export async function makeTemplate(startYear: number, endYear: number): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const kind of ['sst', 'tourism'] as const) {
    const sheet = book.addWorksheet(kind === 'sst' ? 'SST' : 'Tourism');
    const metadata = [
      ['kind', kind], ['label', ''], ['provider', ''], ['sourceCitation', ''],
      ['unit', unitFor(kind)], ['scope', 'citywide-annual-average'],
      ['spatialCoverage', 'Puerto Princesa City, Palawan']
    ];
    metadata.forEach((row, index) => { sheet.getCell(index + 1, 1).value = row[0]; sheet.getCell(index + 1, 2).value = row[1]; });
    sheet.getCell('A9').value = 'year'; sheet.getCell('B9').value = 'value';
    for (let year = startYear; year <= endYear; year += 1) sheet.getCell(`A${year - startYear + 10}`).value = year;
    sheet.getColumn(1).width = 23; sheet.getColumn(2).width = 42;
    sheet.getRow(9).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 9 }];
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function parseWorkbook(buffer: Buffer): Promise<WorkbookSeries[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as never);
  if (book.worksheets.length === 0 || book.worksheets.length > 3) throw badRequest('Workbook must contain one to three supported dataset sheets');
  const series = book.worksheets.map((sheet) => {
    const metadata = new Map<string, string>();
    for (let row = 1; row <= 7; row += 1) {
      metadata.set(String(sheet.getCell(row, 1).text).trim(), String(sheet.getCell(row, 2).text).trim());
    }
    const kind = metadata.get('kind') as DatasetKind;
    if (!kinds.includes(kind)) throw badRequest(`Sheet ${sheet.name} needs a supported kind field`);
    const scope = metadata.get('scope');
    if (scope !== 'citywide-annual-average' && scope !== 'reef-site') throw badRequest(`Sheet ${sheet.name} needs an explicit spatial scope`);
    if (sheet.getCell('A9').text.trim().toLowerCase() !== 'year' || sheet.getCell('B9').text.trim().toLowerCase() !== 'value') {
      throw badRequest(`Sheet ${sheet.name} needs year and value columns on row 9`);
    }
    const rows: string[] = ['year,value'];
    for (let row = 10; row <= sheet.rowCount; row += 1) {
      const year = sheet.getCell(row, 1).text.trim();
      const value = sheet.getCell(row, 2).text.trim();
      if (!value) continue;
      if (!year || !value) throw badRequest(`Sheet ${sheet.name}, row ${row}: enter both year and value`);
      rows.push(`${year},${value}`);
    }
    if (rows.length === 1 && !metadata.get('label') && !metadata.get('sourceCitation')) return null;
    const series: WorkbookSeries = {
      kind,
      label: metadata.get('label') ?? '',
      provider: metadata.get('provider') ?? '',
      sourceCitation: metadata.get('sourceCitation') ?? '',
      unit: metadata.get('unit') ?? '',
      scope,
      spatialCoverage: metadata.get('spatialCoverage') ?? '',
      text: rows.join('\n')
    };
    if (series.label.length < 2 || series.sourceCitation.length < 4 || series.spatialCoverage.length < 2) {
      throw badRequest(`Sheet ${sheet.name}: fill label, sourceCitation, and spatialCoverage before uploading`);
    }
    parseCsv(series.text, series.kind, series.unit);
    return series;
  }).filter((item): item is WorkbookSeries => item !== null);
  if (series.length === 0) throw badRequest('Fill at least one dataset sheet before uploading');
  return series;
}
