import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AiReport, PredictionRecord } from '@ccovert/shared';
import { SCENARIO_LABEL } from '@ccovert/shared';
import { downloadPrediction, getErrorMessage, predictionsApi } from '../lib/api';
import { AppShell, PageHeader } from '../components/AppShell';
import { EmptyState, LoadingState, Notice } from '../components/States';
import { AnnualSeriesChart, AnnualTable, ConditionBadge, ParameterTable, PredictionSummaryCard, SourceTable, WarningList } from '../components/ReferenceChart';

export function HistoryPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('prediction');
  const [records, setRecords] = useState<PredictionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PredictionRecord | null>(null);
  const [reports, setReports] = useState<AiReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    predictionsApi.list(200)
      .then((response) => { setRecords(response.predictions); setTotal(response.total); })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false));
  }, []);

  const open = useCallback((id: string) => {
    predictionsApi.get(id)
      .then(({ prediction }) => setSelected(prediction))
      .catch((openError: unknown) => setError(getErrorMessage(openError)));
    predictionsApi.reportsFor(id).then((response) => setReports(response.reports)).catch(() => setReports([]));
    setParams({ prediction: id }, { replace: true });
  }, [setParams]);

  useEffect(load, [load]);

  useEffect(() => {
    if (selectedId && records.length > 0 && (!selected || selected.predictionId !== selectedId)) {
      const found = records.find((record) => record.predictionId === selectedId);
      if (found) setSelected(found);
      else predictionsApi.get(selectedId).then(({ prediction }) => setSelected(prediction)).catch(() => setSelected(null));
    }
    if (!selectedId) setSelected(null);
  }, [records, selected, selectedId]);

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          eyebrow="Saved runs"
          title="Prediction history"
          description="Every run is stored with the exact inputs, sources, parameters, and model configuration version that produced it."
          action={<Link className="button button-primary" to="/predict">New prediction</Link>}
        />

        {error && <Notice tone="danger" title="Could not load history">{error}</Notice>}
        {loading && <LoadingState label="Loading your predictions" />}
        {!loading && records.length === 0 && !error && (
          <EmptyState title="No saved predictions">
            <p>Run a projection with sourced inputs and it will appear here with its full parameter record.</p>
            <Link className="button button-primary" to="/predict">Run your first prediction</Link>
          </EmptyState>
        )}

        {records.length > 0 && (
          <>
            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">All runs</p><h2>{total} saved</h2></div></div>
              <div className="record-list">
                {records.map((record) => (
                  <div key={record.predictionId} onClick={() => open(record.predictionId)} role="button" tabIndex={0}
                    onKeyDown={(event) => { if (event.key === 'Enter') open(record.predictionId); }}>
                    <PredictionSummaryCard prediction={record} />
                  </div>
                ))}
              </div>
            </section>

            {selected && (
              <section className="panel" id="prediction-detail">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Run detail</p>
                    <h2>{selected.baselineYear}-{selected.baselineYear + selected.horizonYears} &middot; {selected.finalCoverPercent.toFixed(2)}%</h2>
                  </div>
                  <div className="button-row">
                    <button className="button button-small button-secondary" type="button" onClick={() => { setSelected(null); setParams({}, { replace: true }); }}>Close details</button>
                    <button className="button button-small button-secondary" type="button" onClick={() => downloadPrediction(selected.predictionId, 'markdown')}>Markdown</button>
                    <button className="button button-small button-secondary" type="button" onClick={() => downloadPrediction(selected.predictionId, 'csv')}>CSV</button>
                    <button className="button button-small button-secondary" type="button" onClick={() => downloadPrediction(selected.predictionId, 'json')}>JSON</button>
                    <Link className="button button-small button-primary" to={`/ai?prediction=${selected.predictionId}`}>Generate report</Link>
                  </div>
                </div>
                <p className="muted">Request id {selected.requestId}. Configuration {selected.modelConfigVersion}. Created {new Date(selected.createdAt).toLocaleString()}.</p>
                {selected.isDemo && <Notice tone="danger" title="Synthetic DEMO run">This result used synthetic alpha and g values. It must never be cited as a finding.</Notice>}
                {selected.isScenario && <Notice tone="danger" title={SCENARIO_LABEL}>This run substituted analyst-assumed values for parameters the paper does not publish. It is excluded from validated counts and must not be cited as a finding.</Notice>}
                {selected.assumptions.length > 0 && (
                  <>
                    <h3>Assumptions supplied for this run</h3>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Parameter</th><th>Value</th><th>Range</th><th>Applied</th><th>Rationale</th></tr></thead>
                        <tbody>
                          {selected.assumptions.map((assumption) => {
                            const parameter = selected.parameters.find((candidate) => candidate.key === assumption.key);
                            const applied = parameter?.status === 'assumed';
                            return (
                            <tr key={assumption.key}>
                              <td>{assumption.key}</td>
                              <td>{assumption.value} {assumption.unit}</td>
                              <td>{assumption.range ? `${assumption.range.min} to ${assumption.range.max}` : 'not stated'}</td>
                              <td>{applied ? 'yes' : 'no, the configured value was used'}</td>
                              <td>{assumption.rationale}</td>
                            </tr>
                          );})}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <WarningList warnings={selected.warnings} />
                <dl className="detail-list">
                  <div><dt>Status</dt><dd><ConditionBadge label={selected.status} status={selected.status === 'computed' ? 'good' : 'warning'} /></dd></div>
                  <div><dt>Target measure</dt><dd>{selected.targetMeasure}</dd></div>
                  <div><dt>Scope</dt><dd>{selected.scope}</dd></div>
                  <div><dt>Baseline</dt><dd>{selected.initialCoverPercent.toFixed(3)}% in {selected.baselineYear} ({selected.request.coralBaseline.surveySource})</dd></div>
                  <div><dt>Final interval mean</dt><dd>{selected.finalIntervalMeanPercent.toFixed(3)}%</dd></div>
                  <div><dt>Solver</dt><dd>{selected.solver.method.toUpperCase()}, {selected.solver.substepsPerYear} substeps per year, {selected.solver.intervalMeanQuadrature} means</dd></div>
                  <div><dt>Idempotency key</dt><dd>{selected.idempotencyKey ?? 'not supplied'}</dd></div>
                  <div><dt>Consented location</dt><dd>{selected.request.consentedLocation ? 'stored as context only' : 'none'}</dd></div>
                </dl>

                <AnnualSeriesChart prediction={selected} />
                <h3>Annual output</h3>
                <AnnualTable annual={selected.annual} />
                <h3>Parameters</h3>
                <ParameterTable parameters={selected.parameters} />
                <h3>Sources</h3>
                <SourceTable sources={selected.sources} />

                <h3>Reports on this run</h3>
                {reports.length === 0
                  ? <p className="muted">No report has been generated for this run yet.</p>
                  : <ul className="reference-list">{reports.map((report) => <li key={report.id}>{report.title} ({report.generatedBy})</li>)}</ul>}

                <h3>Request</h3>
                <pre className="calculation-rule">{JSON.stringify(selected.request, null, 2)}</pre>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
