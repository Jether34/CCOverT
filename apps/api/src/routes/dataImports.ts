import { Router } from 'express';
import multer from 'multer';
import type { DatasetImportResponse, DatasetListResponse } from '@ccovert/shared';
import { config } from '../config';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, badRequest } from '../utils/errors';
import { sameOriginMiddleware } from '../utils/session';
import { datasetImportFieldsSchema, datasetListQuerySchema, datasetReviewSchema, idSchema } from '../utils/validation';
import { datasetService, datasetUnitHint } from '../services/datasets';
import { makeTemplate, parseWorkbook } from '../services/workbook';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: 1 }
});

export function createDataImportsRouter(): Router {
  const router = Router();

  // Dataset inventory and provenance are researcher/admin workspace data.
  router.get('/', requireRole('researcher', 'admin'), asyncHandler(async (request, response) => {
    const query = datasetListQuerySchema.parse(request.query);
    const body: DatasetListResponse = { datasets: await datasetService.list(query.kind, query.studyAreaId) };
    response.json(body);
  }));

  router.get('/schema/:kind', requireRole('researcher', 'admin'), asyncHandler(async (request, response) => {
    const kind = idSchema.parse(request.params.kind);
    response.json({
      kind,
      expectedUnit: datasetUnitHint(kind as 'sst'),
      requiredColumns: ['year', 'value'],
      example: kind === 'tourism' ? 'year,value\n2006,147806\n2007,161000' : 'year,value\n2006,30.19\n2007,30.2',
      notes: kind === 'sst'
        ? 'Use sea-surface temperature in degC. The paper rejects air temperature as a substitute.'
        : kind === 'tourism'
          ? 'Use citywide annual tourist arrivals, not reef-site visitor counts.'
          : 'Use %LCC (hard coral + soft coral) cover percentages.'
    });
  }));

  router.get('/template', requireRole('researcher'), asyncHandler(async (request, response) => {
    const start = Number(request.query.startYear);
    const end = Number(request.query.endYear);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1900 || end > 2200 || end < start || end - start > 100) {
      throw badRequest('Choose a start and end year between 1900 and 2200, with at most 101 annual rows');
    }
    response.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="ccovert-series-${start}-${end}.xlsx"`);
    response.send(await makeTemplate(start, end));
  }));

  router.post('/bulk', requireRole('researcher'), sameOriginMiddleware, upload.single('file'), asyncHandler(async (request, response) => {
    if (!request.file || !request.file.originalname.toLowerCase().endsWith('.xlsx')) throw badRequest('Choose a completed .xlsx workbook');
    const series = await parseWorkbook(request.file.buffer);
    const datasets = [];
    const warnings: string[] = [];
    for (const item of series) {
      const result = await datasetService.importCsv({ ...item, ownerId: request.user!.id, fileName: request.file.originalname });
      datasets.push(result.dataset);
      warnings.push(...result.warnings.map((warning) => `${item.label}: ${warning}`));
    }
    response.status(201).json({ datasets, warnings });
  }));

  router.post('/', requireRole('researcher'), sameOriginMiddleware, upload.single('file'), asyncHandler(async (request, response) => {
    if (!request.file) throw badRequest('Attach a CSV file with year and value columns');
    const fields = datasetImportFieldsSchema.parse(request.body);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(request.file.buffer);
    } catch {
      throw badRequest('The CSV file must be UTF-8 encoded');
    }
    const result: DatasetImportResponse = await datasetService.importCsv({
      kind: fields.kind,
      label: fields.label,
      provider: fields.provider,
      sourceCitation: fields.sourceCitation,
      unit: fields.unit,
      scope: fields.scope,
      spatialCoverage: fields.spatialCoverage,
      fileName: request.file.originalname,
      text,
      ownerId: request.user!.id,
      status: fields.reviewStatus
    });
    response.status(201).json(result);
  }));

  router.post('/:id/review', requireRole('admin'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const datasetId = idSchema.parse(request.params.id);
    const input = datasetReviewSchema.parse(request.body);
    // Admin-only: this is the sole path that can set a series to `validated`,
    // which is what a paper-profile run requires.
    const dataset = await datasetService.reviewDataset({
      datasetId,
      status: input.status,
      notes: input.notes,
      reviewedById: request.user!.id,
      reviewedByLabel: request.user!.email
    });
    response.json({ dataset });
  }));

  router.post('/:id/estimate-g', requireRole('researcher'), sameOriginMiddleware, asyncHandler(async (request, response) => {
    const dataset = await datasetService.saveEstimatedGrowthParameter(idSchema.parse(request.params.id), request.user!.id);
    response.json({ dataset });
  }));

  return router;
}
