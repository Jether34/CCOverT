import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeTemplate, parseWorkbook } from '../src/services/workbook';

describe('researcher Excel template', () => {
  it('recognizes selected years and dataset kind from workbook contents', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await makeTemplate(2006, 2008) as never);
    const sst = book.getWorksheet('SST')!;
    sst.getCell('B2').value = 'Citywide sea-surface temperature';
    sst.getCell('B3').value = 'SST provider';
    sst.getCell('B4').value = 'SST observations 2024';
    sst.getCell('B10').value = 30.19;
    sst.getCell('B11').value = 30.2;
    sst.getCell('B12').value = 30.21;
    const parsed = await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe('sst');
    expect(parsed[0].text).toContain('2006,30.19');
    expect(parsed[0].text).toContain('2008,30.21');
  });

  it('refuses a workbook with no supplied values or citation', async () => {
    await expect(parseWorkbook(await makeTemplate(2006, 2008))).rejects.toThrow('Fill at least one dataset sheet');
  });
});
