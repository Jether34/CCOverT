import crypto from 'node:crypto';
import {
  AI_NOT_CONFIGURED,
  PAPER_REPRODUCTION_LABEL,
  SCENARIO_LABEL,
  STUDY_AREA,
  type AiCitation,
  type AiReport,
  type AiReportKind
} from '@ccovert/shared';
import { config } from '../config';
import { logger } from '../logger';
import { aiClient } from './modelClient';
import { badRequest, notFound, unprocessable } from '../utils/errors';
import { db, type PredictionRecordStored, type UploadRecordStored } from '../repositories/database';
import { readUploadText } from './uploads';

const formatNumber = (value: number, digits = 2): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(digits);
const DEMO_LABEL = 'DEMO—synthetic, not a validated finding';

/**
 * Non-negotiable interpretation limits. These are appended by the server to
 * every report, not merely requested in the provider prompt, so a provider that
 * omits them cannot produce an unlabelled report.
 */
export const INTERPRETATION_LIMITS = [
  'The thermal coefficient and tourism growth rate were not published in the paper; any configured value is recorded with its source dataset.',
  'Temperature inputs must be sea-surface temperature. The paper rejects air temperature as a substitute.',
  'Condition bands are an analyst convention over 0-100 percent, not a published classification.',
  'The paper reports an MAE of 0.30 that this implementation cannot reconcile; treat fit quality as unverified.'
];

const limitationsSection = (): string[] => [
  '## Interpretation limits',
  '',
  ...INTERPRETATION_LIMITS.map((line) => `- ${line}`),
  ''
];

const percentChange = (from: number, to: number): string => {
  if (from === 0) return 'n/a';
  const change = ((to - from) / from) * 100;
  return `${change >= 0 ? '+' : ''}${formatNumber(change, 1)}%`;
};

export interface ReportInput {
  userId: string;
  predictionIds: string[];
  uploadIds: string[];
  question: string | null;
}

export class AiReportService {
  public providerAvailable(): boolean {
    return aiClient.configured;
  }

  /** Loads and authorizes every referenced record before any generation. */
  private async loadContext(input: ReportInput): Promise<{ predictions: PredictionRecordStored[]; uploads: UploadRecordStored[] }> {
    if (input.predictionIds.length === 0 && input.uploadIds.length === 0) {
      throw unprocessable('Choose at least one saved prediction or upload one source document to report on');
    }
    if (input.predictionIds.length > 20) throw unprocessable('A report can cover at most 20 predictions');
    if (input.uploadIds.length > 20) throw unprocessable('A report can cite at most 20 uploads');

    const predictions: PredictionRecordStored[] = [];
    for (const id of input.predictionIds) {
      const prediction = await db.findPredictionForUser(id, input.userId);
      if (!prediction) throw notFound(`No saved prediction with id ${id} belongs to this account`);
      predictions.push(prediction);
    }
    const uploads: UploadRecordStored[] = [];
    for (const id of input.uploadIds) {
      const upload = await db.findUploadForUser(id, input.userId);
      if (!upload) throw notFound(`No upload with id ${id} belongs to this account`);
      if (upload.extractionStatus !== 'text-available' || !upload.textPreview?.trim()) {
        throw unprocessable('The selected document has no verified extracted text; OCR or a text-readable replacement is required');
      }
      uploads.push(upload);
    }
    return { predictions, uploads };
  }

  private kind(predictions: PredictionRecordStored[]): AiReportKind {
    return predictions.length > 1 ? 'history-summary' : 'single-prediction';
  }

  private title(kind: AiReportKind, predictions: PredictionRecordStored[]): string {
    if (predictions.length === 0) return `Document report: ${STUDY_AREA.label}`;
    if (kind === 'single-prediction') {
      const prediction = predictions[0];
      return `Prediction report: ${STUDY_AREA.label}, ${prediction.baselineYear}-${prediction.baselineYear + prediction.horizonYears}`;
    }
    return `Prediction history summary: ${predictions.length} runs for ${STUDY_AREA.label}`;
  }

  /**
   * A fully deterministic report built only from stored numbers. It is the
   * default when no AI provider is configured and is never presented as an
   * AI-generated narrative.
   */
  private deterministicSummary(input: {
    predictions: PredictionRecordStored[];
    uploads: UploadRecordStored[];
    question: string | null;
  }): { body: string; citations: AiCitation[]; warnings: string[] } {
    const { predictions, uploads, question } = input;
    const lines: string[] = [];
    const citations: AiCitation[] = [];
    const warnings: string[] = [
      'No AI provider is configured, so this report is a deterministic summary of stored results rather than a generated narrative.'
    ];

    lines.push(`# ${STUDY_AREA.label} coral cover model report`);
    lines.push('');
    if (predictions.length > 0) {
      lines.push(`- Target measure: ${predictions[0].targetMeasure}`);
      lines.push(`- Study area: ${STUDY_AREA.label} (${predictions[0].scope})`);
      lines.push(`- Model configuration version: ${predictions.map((prediction) => prediction.modelConfigVersion).join(', ')}`);
      lines.push(`- Equation version: ${predictions[0].equationVersion}`);
    } else {
      lines.push('- No prediction history was selected; this report is grounded in uploaded source documents.');
    }
    lines.push('');

    // A single exploratory run gets the same treatment as a mixed comparison:
    // the report must never read as a finding without saying so.
    const anyScenario = predictions.filter((prediction) => prediction.isScenario);
    if (anyScenario.length > 0) {
      warnings.push(
        `${SCENARIO_LABEL}: ${anyScenario.length} of ${predictions.length} runs are exploratory scenarios built on assumed values. They are not validated predictions and must not be cited as findings.`
      );
      lines.push(
        `- ${SCENARIO_LABEL}: ${anyScenario.length} of ${predictions.length} runs are exploratory scenarios based on assumed values, not validated predictions.`
      );
      lines.push('');
    }
    if (predictions.some((prediction) => prediction.isDemo)) {
      lines.push(`- ${DEMO_LABEL}. Synthetic runs cannot be cited as research findings.`);
      warnings.push(DEMO_LABEL);
    }
    if (predictions.some((prediction) => prediction.isPaperReproduction)) {
      lines.push(`- ${PAPER_REPRODUCTION_LABEL}`);
      lines.push('- Paper-reproduction uses alpha = 0.05, configured piecewise tourism growth, and C0 = 57% in 2006. K and beta are provisional/inferred; the paper also reports conflicting C0 values of 57.25% and 45.83%. This result is not 100% accurate and is not independently validated.');
      warnings.push(PAPER_REPRODUCTION_LABEL);
    }

    for (const prediction of predictions) {
      const endYear = prediction.baselineYear + prediction.horizonYears;
      lines.push(`## Run ${prediction.id.slice(0, 8)} (${prediction.baselineYear}-${endYear})`);
      lines.push('');
      lines.push(`- Status: ${prediction.isDemo ? 'DEMO (synthetic parameters)' : prediction.isScenario ? `SCENARIO (${SCENARIO_LABEL})` : 'computed'}`);
      const assumptions = prediction.assumptions ?? [];
      if (assumptions.length > 0) {
        lines.push(`- Assumed values: ${assumptions.map((assumption) => `${assumption.key} = ${assumption.value} ${assumption.unit} (${assumption.rationale})`).join('; ')}`);
      }
      lines.push(`- Initial cover: ${formatNumber(prediction.initialCoverPercent)}%`);
      lines.push(`- Final cover (end of ${endYear}): ${formatNumber(prediction.finalCoverPercent)}%`);
      lines.push(`- Change: ${formatNumber(prediction.finalCoverPercent - prediction.initialCoverPercent)} percentage points (${percentChange(prediction.initialCoverPercent, prediction.finalCoverPercent)})`);
      lines.push(`- Final interval mean: ${formatNumber(prediction.finalIntervalMeanPercent)}%`);
      lines.push(`- Condition at end state: ${prediction.stateClassification ?? 'unclassified'}`);
      lines.push(`- Created: ${prediction.createdAt}`);
      lines.push('- Validation status: not independently validated.');
      lines.push(`- Parameter status: ${prediction.parameters.map((parameter) => `${parameter.key}=${parameter.status}/${parameter.reviewStatus}`).join('; ')}`);
      lines.push(`- Data provenance: ${prediction.sources.map((source) => `${source.name}: ${source.source}`).join('; ')}`);
      if (prediction.warnings.length > 0) {
        lines.push('- Warnings carried from the model run:');
        for (const warning of prediction.warnings) lines.push(`  - ${warning}`);
      }
      const missing = prediction.parameters.filter((parameter) => parameter.value === null);
      if (missing.length > 0) {
        lines.push(`- Parameters with no value: ${missing.map((parameter) => parameter.key).join(', ')}`);
      }
      const configured = prediction.parameters.filter((parameter) => parameter.sourceDatasetId);
      if (configured.length > 0) {
        lines.push(`- Parameters configured from imported data: ${configured.map((parameter) => `${parameter.key} (dataset ${parameter.sourceDatasetId})`).join(', ')}`);
      }
      lines.push('');
      citations.push({
        predictionId: prediction.id,
        uploadId: null,
        filename: null,
        page: null,
        excerpt: `Stored prediction result: ${formatNumber(prediction.initialCoverPercent)}% in ${prediction.baselineYear} to ${formatNumber(prediction.finalCoverPercent)}% in ${endYear}.`
      });
    }

    if (predictions.length > 1) {
      const highest = predictions.reduce((best, prediction) => (prediction.finalCoverPercent > best.finalCoverPercent ? prediction : best));
      const lowest = predictions.reduce((best, prediction) => (prediction.finalCoverPercent < best.finalCoverPercent ? prediction : best));
      lines.push('## Comparison across runs');
      lines.push('');
      lines.push(`- Highest final cover: ${formatNumber(highest.finalCoverPercent)}% (run ${highest.id.slice(0, 8)})`);
      lines.push(`- Lowest final cover: ${formatNumber(lowest.finalCoverPercent)}% (run ${lowest.id.slice(0, 8)})`);
      lines.push(`- Spread: ${formatNumber(highest.finalCoverPercent - lowest.finalCoverPercent)} percentage points`);
      const demoRuns = predictions.filter((prediction) => prediction.isDemo);
      if (demoRuns.length > 0) {
        warnings.push(`${demoRuns.length} of ${predictions.length} runs used synthetic DEMO parameters and must not be cited as findings.`);
        lines.push(`- ${demoRuns.length} of ${predictions.length} runs used synthetic DEMO parameters.`);
      }
      const scenarioRuns = predictions.filter((prediction) => prediction.isScenario);
      if (scenarioRuns.length > 0) {
        warnings.push(
          `${scenarioRuns.length} of ${predictions.length} runs are exploratory scenarios built on assumed values. They are not validated predictions and must not be cited as findings or compared against validated runs.`
        );
        lines.push(`- ${scenarioRuns.length} of ${predictions.length} runs are exploratory scenarios based on assumed values.`);
      }
      if (demoRuns.length === 0 && scenarioRuns.length === 0) {
        lines.push('- All runs in this comparison use configured parameters.');
      }
      const configs = new Set(predictions.map((prediction) => prediction.modelConfigVersion));
      if (configs.size > 1) {
        warnings.push(`These runs use ${configs.size} different model configuration versions, so differences are not attributable to the inputs alone.`);
        lines.push(`- Model configuration versions used: ${[...configs].join(', ')}`);
      }
      lines.push('');
    }

    if (uploads.length > 0) {
      lines.push('## Source documents');
      lines.push('');
      for (const upload of uploads) {
        lines.push(`- ${upload.filename} (${upload.sizeBytes} bytes, extracted: ${upload.extractionStatus})`);
        citations.push({
          predictionId: null,
          uploadId: upload.id,
          filename: upload.filename,
          page: null,
          excerpt: 'Uploaded source document referenced by this report.'
        });
      }
      lines.push('');
    }

    if (question) {
      lines.push('## Your question');
      lines.push('');
      lines.push(`> ${question}`);
      lines.push('');
      lines.push('This summary reports only values stored by the model. It does not interpret the question, and it does not answer anything the stored data does not already contain.');
      lines.push('');
    }

    lines.push(...limitationsSection());
    lines.push(`_Generated ${new Date().toISOString()} by the deterministic summary generator._`);

    return { body: lines.join('\n'), citations, warnings };
  }

  public async create(input: ReportInput): Promise<AiReport> {
    const { predictions, uploads } = await this.loadContext(input);
    const kind = this.kind(predictions);
    const allowedKeys = new Set([...predictions.map((prediction) => prediction.id), ...uploads.map((upload) => upload.id)]);

    let body: string;
    let citations: AiCitation[];
    let warnings: string[];
    let generatedBy: AiReport['generatedBy'] = 'deterministic-summary';
    let provider: string | null = null;
    let model: string | null = null;

    if (aiClient.configured) {
      const documents: string[] = [];
      for (const upload of uploads) {
        const { filename, text } = await readUploadText(upload.id, input.userId);
        documents.push(`[upload:${upload.id}] ${filename}\n${text}`);
      }
      const result = await aiClient.generate({
        system: [
          'You write factual coral reef model reports.',
          'Use only the supplied model results and documents. Never invent data, sources, or parameter values.',
          `If any supplied run is a scenario, include the exact label "${SCENARIO_LABEL}" prominently and state that it is excluded from validated findings.`,
          `If any supplied run is a demo, include the exact label "${DEMO_LABEL}" prominently. No supplied run has independent validation; never call it a validated finding.`,
          `If any supplied run is paper-reproduction, include the exact label "${PAPER_REPRODUCTION_LABEL}" and state alpha = 0.05, configured piecewise tourism growth, C0 = 57% in 2006, provisional/inferred K and beta, conflicting paper C0 values, and that it is not independently validated or 100% accurate.`,
          'Always include the paper limitation that alpha and g were not published and that any configured value must be cited to its dataset.',
          'Return JSON with keys: body (markdown string), citations (array of {predictionId, uploadId, filename, page, excerpt}), warnings (array of strings).',
          'Every citation must reference a predictionId or uploadId supplied in the user message, and the excerpt must be copied from the supplied text or numbers.'
        ].join(' '),
        user: [
          input.question ? `Question: ${input.question}` : 'Write a report about the supplied model results.',
          '',
          'Model results:',
          ...predictions.map((prediction) => JSON.stringify({
            id: prediction.id,
            baselineYear: prediction.baselineYear,
            horizonYears: prediction.horizonYears,
            initialCoverPercent: prediction.initialCoverPercent,
            finalCoverPercent: prediction.finalCoverPercent,
            finalIntervalMeanPercent: prediction.finalIntervalMeanPercent,
            isDemo: prediction.isDemo,
            isScenario: prediction.isScenario,
            isPaperReproduction: prediction.isPaperReproduction,
            assumptions: (prediction.assumptions ?? []).map((assumption) => ({
              key: assumption.key,
              value: assumption.value,
              unit: assumption.unit,
              rationale: assumption.rationale,
              range: assumption.range
            })),
            modelConfigVersion: prediction.modelConfigVersion,
            warnings: prediction.warnings,
            parameters: prediction.parameters.map((parameter) => ({ key: parameter.key, status: parameter.status, reviewStatus: parameter.reviewStatus, provenance: parameter.provenance })),
            sources: prediction.sources,
            validationStatus: 'not independently validated'
          })),
          '',
          documents.length > 0 ? 'Documents:' : '',
          ...documents
        ].join('\n'),
        allowedCitationKeys: [...allowedKeys],
        timeoutMs: 30000
      });
      body = result.body;
      citations = result.citations;
      warnings = result.warnings;
      generatedBy = 'ai-provider';
      provider = result.provider;
      model = result.model;
    } else {
      const summary = this.deterministicSummary({ predictions, uploads, question: input.question });
      body = summary.body;
      citations = summary.citations;
      warnings = summary.warnings;
    }

    if (predictions.some((prediction) => prediction.isScenario)) {
      if (!body.includes(SCENARIO_LABEL)) body = `**${SCENARIO_LABEL}**\n\n${body}`;
      if (!warnings.some((warning) => warning.includes(SCENARIO_LABEL))) {
        warnings.unshift(`${SCENARIO_LABEL}: scenario results are excluded from validated findings.`);
      }
    }
    if (predictions.some((prediction) => prediction.isDemo)) {
      if (!body.includes(DEMO_LABEL)) body = `**${DEMO_LABEL}**\n\n${body}`;
      if (!warnings.some((warning) => warning.includes(DEMO_LABEL))) warnings.unshift(DEMO_LABEL);
    }
    if (predictions.some((prediction) => prediction.isPaperReproduction)) {
      if (!body.includes(PAPER_REPRODUCTION_LABEL)) body = `**${PAPER_REPRODUCTION_LABEL}**\n\n${body}`;
      if (!warnings.some((warning) => warning.includes(PAPER_REPRODUCTION_LABEL))) warnings.unshift(PAPER_REPRODUCTION_LABEL);
    }

    if (input.question && !aiClient.configured) {
      warnings.push('Your question was recorded but not answered because no AI provider is configured on this environment.');
    }

    // A provider is not trusted to volunteer its own limitations. Re-attach the
    // server-owned limits block so an AI report can never be less caveated than
    // the deterministic summary, and flag it when the model already wrote one.
    if (generatedBy === 'ai-provider') {
      if (body.includes('## Interpretation limits')) {
        warnings.push(
          `The provider wrote its own interpretation-limits section. The mandatory server limits are: ${INTERPRETATION_LIMITS.join(' ')}`
        );
      }
      body = `${body.trimEnd()}\n\n${limitationsSection().join('\n')}`;
    }

    const id = crypto.randomUUID();
    const record = {
      _id: id,
      id,
      userId: input.userId,
      kind,
      title: this.title(kind, predictions),
      body,
      generatedBy,
      provider,
      model,
      referencedPredictionIds: predictions.map((prediction) => prediction.id),
      referencedUploadIds: uploads.map((upload) => upload.id),
      citations,
      warnings,
      createdAt: new Date().toISOString()
    };
    // A report is a snapshot of the selected prediction history. Replacing a
    // report for the same prediction prevents stale interpretations from
    // appearing current after that run is selected again.
    await db.invalidateAiReportsForPredictions(input.userId, predictions.map((prediction) => prediction.id));
    await db.createAiReport(record);
    logger.info('Created an AI report', { reportId: record.id, kind, generatedBy, predictions: predictions.length, uploads: uploads.length });
    const { _id, userId, ...report } = record;
    return report;
  }

  public async list(userId: string): Promise<AiReport[]> {
    const reports = await db.listAiReports(userId);
    return reports.map(({ _id, userId: _userId, ...report }) => report);
  }

  public async get(id: string, userId: string): Promise<AiReport> {
    const report = await db.findAiReportForUser(id, userId);
    if (!report) throw notFound('No such report for this account');
    const { _id, userId: _userId, ...rest } = report;
    return rest;
  }

  public async listForPrediction(predictionId: string, userId: string): Promise<AiReport[]> {
    const prediction = await db.findPredictionForUser(predictionId, userId);
    if (!prediction) throw badRequest('No such prediction for this account');
    const reports = await db.listAiReportsForPrediction(userId, predictionId);
    return reports.map(({ _id, userId: _userId, ...report }) => report);
  }

  public aiStatus(): { configured: boolean; provider: string } {
    return {
      configured: aiClient.configured,
      provider: aiClient.configured ? config.ai.provider : AI_NOT_CONFIGURED
    };
  }
}

export const aiReportService = new AiReportService();
