import { PAPER_REPRODUCTION_LABEL, SCENARIO_DISCLAIMER, SCENARIO_LABEL, STUDY_AREA, type PredictionRecord } from '@ccovert/shared';
import type { PredictionRecordStored } from '../repositories/database';

export type DownloadFormat = 'pdf' | 'csv' | 'markdown';

const statusLabel = (prediction: PredictionRecordStored): string => {
  if (prediction.isDemo) return 'DEMO (synthetic parameters, not for research use)';
  if (prediction.isScenario) return `SCENARIO (${SCENARIO_LABEL}; exploratory, based on assumed values)`;
  if (prediction.isPaperReproduction) return PAPER_REPRODUCTION_LABEL;
  return 'computed';
};

const formatNumber = (value: number | null, digits = 2): string =>
  value === null || !Number.isFinite(value) ? '' : (Number.isInteger(value) ? String(value) : value.toFixed(digits));

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const baseName = (prediction: PredictionRecordStored): string =>
  `prediction-${prediction.baselineYear}-${prediction.forecastEndYear ?? prediction.baselineYear + prediction.horizonYears}-${prediction.id.slice(0, 8)}`;

export function toCsv(prediction: PredictionRecordStored): string {
  const header = [
    'year', 'tYears', 'coverStartPercent', 'coverEndPercent', 'coverIntervalMeanPercent',
    'temperatureStartC', 'temperatureEndC', 'tourismStartArrivals', 'tourismEndArrivals',
    'growthRateMean', 'thermalRateMean', 'tourismRateMean', 'tourismGrowthRate', 'tourismPeriodStartYear', 'tourismPeriodEndYear',
    'growthContributionPp', 'thermalContributionPp', 'tourismContributionPp',
    'stateClassification', 'meanClassification'
  ];
  const rows = prediction.annual.map((point) => [
    point.year, point.tYears, formatNumber(point.coverStartPercent), formatNumber(point.coverEndPercent),
    formatNumber(point.coverIntervalMeanPercent), formatNumber(point.temperatureStartC), formatNumber(point.temperatureEndC),
    formatNumber(point.tourismStartArrivals), formatNumber(point.tourismEndArrivals),
    formatNumber(point.growthRateMean, 6), formatNumber(point.thermalRateMean, 6), formatNumber(point.tourismRateMean, 6), formatNumber(point.tourismGrowthRate, 6), point.tourismPeriodStartYear ?? '', point.tourismPeriodEndYear ?? '',
    formatNumber(point.growthContributionPp), formatNumber(point.thermalContributionPp), formatNumber(point.tourismContributionPp),
    point.stateClassification ?? '', point.meanClassification ?? ''
  ].map(csvCell).join(','));
  const parameterBlock = [
    '',
    '# parameters',
    'key,symbol,value,unit,status,provenance',
    ...prediction.parameters.map((parameter) => [
      parameter.key, parameter.symbol, parameter.value === null ? '' : String(parameter.value),
      csvCell(parameter.unit), parameter.status, csvCell(parameter.provenance)
    ].join(',')),
    '',
    '# sources',
    'name,source,unit,timeWindow,coverage,scope,datasetId',
    ...prediction.sources.map((source) => [
      csvCell(source.name), csvCell(source.source), csvCell(source.unit), csvCell(source.timeWindow),
      csvCell(source.coverage ?? ''), csvCell(source.scope ?? ''), source.datasetId ?? ''
    ].join(','))
  ];
  return `${['# CCOverT prediction', header.map(csvCell).join(','), `# status,${csvCell(statusLabel(prediction))}`, ...rows, ...parameterBlock].join('\n')}\n`;
}

export function toMarkdown(prediction: PredictionRecordStored): string {
  const endYear = prediction.forecastEndYear ?? prediction.baselineYear + prediction.horizonYears;
  const lines: string[] = [];
  lines.push(`# CCOverT prediction: ${STUDY_AREA.label}`);
  lines.push('');
  lines.push(`- Prediction id: ${prediction.id}`);
  lines.push(`- Model configuration version: ${prediction.modelConfigVersion}`);
  lines.push(`- Equation version: ${prediction.equationVersion} (model ${prediction.modelVersion})`);
  lines.push(`- Target measure: ${prediction.targetMeasure}`);
  lines.push(`- Scope: ${prediction.scope}`);
  lines.push(`- Status: ${statusLabel(prediction)}`);
  if (prediction.isPaperReproduction) lines.push(`- ${PAPER_REPRODUCTION_LABEL}`);
  lines.push(`- Initial baseline: ${formatNumber(prediction.initialCoverPercent)}% in ${prediction.baselineYear}`);
  lines.push(`- Forecast ending year: ${endYear} (${prediction.horizonYears} years)`);
  if (prediction.tourismGrowthPeriods?.length) {
    lines.push('- Tourism growth periods: ' + prediction.tourismGrowthPeriods.map((period) => `${period.startYear}-${period.endYear}: ${period.growthRate} ${period.unit}`).join('; '));
  }
  if (prediction.failureReason) lines.push(`- Run outcome: not completed — ${prediction.failureReason}`);
  lines.push('- Validation status: not independently validated');
  lines.push(`- Solver: ${prediction.solver.method}, ${prediction.solver.substepsPerYear} substeps per year, ${prediction.solver.intervalMeanQuadrature} interval means`);
  lines.push(`- Created: ${prediction.createdAt}`);
  lines.push('');

  const assumptions = prediction.assumptions ?? [];
  if (assumptions.length > 0) {
    lines.push('## Scenario assumptions');
    lines.push('');
    lines.push(SCENARIO_DISCLAIMER);
    lines.push('');
    lines.push('| key | assumed value | unit | range | applied | rationale |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const assumption of assumptions) {
      const range = assumption.range ? `${assumption.range.min} to ${assumption.range.max}` : 'not stated';
      // A stored assumption is not necessarily an applied one: a value for an
      // already-configured parameter is kept for the audit trail and ignored.
      const parameter = prediction.parameters.find((candidate) => candidate.key === assumption.key);
      const applied = parameter?.status === 'assumed' ? 'yes' : 'no, the configured value was used';
      lines.push(`| ${assumption.key} | ${assumption.value} | ${assumption.unit} | ${range} | ${applied} | ${assumption.rationale} |`);
    }
    lines.push('');
  }

  lines.push('## Parameters');
  lines.push('');
  lines.push('| key | symbol | value | unit | status | provenance |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const parameter of prediction.parameters) {
    lines.push(`| ${parameter.key} | ${parameter.symbol} | ${parameter.value === null ? 'not configured' : parameter.value} | ${parameter.unit} | ${parameter.status} | ${parameter.provenance} |`);
  }
  lines.push('');
  lines.push('## Sources');
  lines.push('');
  lines.push('| series | source | unit | window | coverage |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const source of prediction.sources) {
    lines.push(`| ${source.name} | ${source.source} | ${source.unit} | ${source.timeWindow} | ${source.coverage ?? 'n/a'} |`);
  }
  lines.push('');
  lines.push('## Annual output');
  lines.push('');
  lines.push('| year | cover start % | cover end % | interval mean % | mean SST (degC) | tourist arrivals | mean net rate /yr | condition |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  if (prediction.annual.length === 0) lines.push('| No annual output was produced because the model refused or failed this run. | | | | | | | |');
  for (const point of prediction.annual) {
    const meanSst = (point.temperatureStartC + point.temperatureEndC) / 2;
    const meanTourism = (point.tourismStartArrivals + point.tourismEndArrivals) / 2;
    const meanRate = point.growthRateMean + point.thermalRateMean + point.tourismRateMean;
    lines.push(`| ${point.year} | ${formatNumber(point.coverStartPercent)} | ${formatNumber(point.coverEndPercent)} | ${formatNumber(point.coverIntervalMeanPercent)} | ${formatNumber(meanSst)} | ${formatNumber(meanTourism, 0)} | ${formatNumber(meanRate, 4)} | ${point.meanClassification ?? 'unclassified'} |`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- ${formatNumber(prediction.initialCoverPercent)}% in ${prediction.baselineYear} to ${formatNumber(prediction.finalCoverPercent)}% at the end of ${endYear}`);
  lines.push(`- Net change: ${formatNumber(prediction.finalCoverPercent - prediction.initialCoverPercent)} percentage points`);
  lines.push(`- Final interval mean cover: ${formatNumber(prediction.finalIntervalMeanPercent)}%`);
  lines.push(`- Condition classification (${prediction.classificationConvention.label}): ${prediction.stateClassification ?? 'unclassified'} at the end state, ${prediction.meanClassification ?? 'unclassified'} on the interval mean`);
  lines.push('');
  if (prediction.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of prediction.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  lines.push('## Limitations');
  lines.push('');
  lines.push('- The thermal coefficient (alpha) and tourism growth rate (g) were not published. Alpha may be marked "not required for horizon" only when the SST driver never exceeds Tcrit; this is not a configured alpha value.');
  lines.push('- Temperature inputs must be sea-surface temperature; the paper rejects air temperature as a substitute.');
  lines.push('- Condition bands are an analyst convention over 0-100 percent, not a published classification.');
  lines.push('- The paper-reported MAE of 0.30 is not reproducible from the published inputs; fit quality is unverified.');
  lines.push('');
  lines.push(`_Exported ${new Date().toISOString()}. This is a model projection, not an observation._`);
  return `${lines.join('\n')}\n`;
}

const pdfEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '?');

/** Minimal dependency-free PDF export using the report's complete text content. */
export function toPdf(prediction: PredictionRecordStored): Buffer {
  const wrapped = toMarkdown(prediction).split('\n').flatMap((line) => {
    if (line.length <= 96) return [line];
    const parts: string[] = [];
    for (let index = 0; index < line.length; index += 96) parts.push(line.slice(index, index + 96));
    return parts;
  });
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += fiftyFiveLines) pages.push(wrapped.slice(index, index + fiftyFiveLines));
  const pageLines = pages.length > 0 ? pages : [['CCOverT prediction report']];
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  pageLines.forEach((lines) => {
    const content = ['BT', '/F1 9 Tf', '42 770 Td', ...lines.flatMap((line, index) => [`(${pdfEscape(line)}) Tj`, index === lines.length - 1 ? '' : '0 -13 Td']), 'ET'].filter(Boolean).join('\n');
    const contentId = objects.length + 1;
    objects.push(`<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`);
    contentObjectIds.push(contentId);
    const pageId = objects.length + 1;
    objects.push('');
    pageObjectIds.push(pageId);
    const pageIndex = pageId - 1;
    objects[pageIndex] = '';
  });
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(' ');
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageObjectIds.length} >>`;
  const fontId = objects.length + 1;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pageObjectIds.forEach((id, index) => { objects[id - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`; });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'binary')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

const fiftyFiveLines = 55;

export function renderDownload(prediction: PredictionRecordStored, format: DownloadFormat): { body: string | Buffer; contentType: string; extension: string } {
  switch (format) {
    case 'csv':
      return { body: toCsv(prediction), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
    case 'markdown':
      return { body: toMarkdown(prediction), contentType: 'text/markdown; charset=utf-8', extension: 'md' };
    default:
      return { body: toPdf(prediction), contentType: 'application/pdf', extension: 'pdf' };
  }
}

export const downloadFileName = (prediction: PredictionRecordStored, format: DownloadFormat): string =>
  `${baseName(prediction)}.${renderDownload(prediction, format).extension}`;

export const toPublicRecord = (prediction: PredictionRecordStored): PredictionRecord => ({
  predictionId: prediction.id,
  requestId: prediction.requestId,
  status: prediction.status,
  validationStatus: prediction.validationStatus ?? 'not-validated',
  isDemo: prediction.isDemo,
  isScenario: prediction.isScenario,
  isPaperReproduction: prediction.isPaperReproduction,
  alphaResolution: prediction.alphaResolution,
  profile: prediction.isPaperReproduction ? 'paper-reproduction' : prediction.isScenario ? 'scenario' : prediction.isDemo ? 'demo' : 'paper',
  tourismGrowthPeriods: prediction.tourismGrowthPeriods,
  assumptions: prediction.assumptions ?? [],
  equationVersion: prediction.equationVersion,
  modelVersion: prediction.modelVersion,
  modelConfigVersion: prediction.modelConfigVersion,
  modelConfigBaselineYear: prediction.modelConfigBaselineYear,
  targetMeasure: prediction.targetMeasure,
  studyArea: prediction.studyArea,
  scope: prediction.scope,
  baselineYear: prediction.baselineYear,
  predictionStartYear: prediction.predictionStartYear ?? prediction.baselineYear,
  horizonYears: prediction.horizonYears,
  forecastEndYear: prediction.forecastEndYear ?? prediction.baselineYear + prediction.horizonYears,
  initialCoverPercent: prediction.initialCoverPercent,
  finalCoverPercent: prediction.finalCoverPercent,
  finalIntervalMeanPercent: prediction.finalIntervalMeanPercent,
  stateClassification: prediction.stateClassification,
  meanClassification: prediction.meanClassification,
  classificationConvention: prediction.classificationConvention,
  annual: prediction.annual,
  parameters: prediction.parameters,
  solver: prediction.solver,
  sources: prediction.sources,
  warnings: prediction.warnings,
  failureReason: prediction.failureReason ?? null,
  createdAt: prediction.createdAt,
  userId: prediction.userId,
  idempotencyKey: prediction.idempotencyKey,
  request: prediction.request
});
