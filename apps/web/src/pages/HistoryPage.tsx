import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AiReport, PredictionRecord } from '@ccovert/shared';
import { SCENARIO_LABEL } from '@ccovert/shared';
import { downloadPrediction, getErrorMessage, predictionsApi } from '../lib/api';
import { AppShell, PageHeader } from '../components/AppShell';
import { EmptyState, LoadingState, Notice } from '../components/States';
import { AnnualSeriesChart, AnnualTable, ComputationBreakdownTable, ConditionBadge, MathematicalBreakdown, ParameterTable, PredictionSummaryCard, SourceTable } from '../components/ReferenceChart';

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
      <div className="page-container history-page">
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
                    <h2>{selected.baselineYear}-{selected.forecastEndYear ?? selected.baselineYear + selected.horizonYears} &middot; {selected.status === 'unavailable' ? 'Not completed' : `${selected.finalCoverPercent.toFixed(2)}%`}</h2>
                  </div>
                  <div className="button-row">
                    <button className="button button-small button-secondary" type="button" onClick={() => { setSelected(null); setParams({}, { replace: true }); }}>Close details</button>
                    <button className="button button-small button-secondary" type="button" onClick={() => downloadPrediction(selected.predictionId, 'pdf')}>PDF</button>
                    <button className="button button-small button-secondary" type="button" onClick={() => downloadPrediction(selected.predictionId, 'csv')}>CSV</button>
                    <Link className="button button-small button-primary" to={`/ai?prediction=${selected.predictionId}`}>Generate report</Link>
                  </div>
                </div>
                <div className="history-detail-scroll">
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
                {selected.status === 'unavailable' && <Notice tone="danger" title="Prediction not completed">{selected.failureReason ?? 'The model did not produce an output for this attempt.'} This attempt is retained for traceability; it is not a prediction result.</Notice>}
                <dl className="detail-list">
                  <div><dt>Status</dt><dd><ConditionBadge label={selected.status} status={selected.status === 'computed' ? 'good' : 'warning'} /></dd></div>
                  <div><dt>Target measure</dt><dd>{selected.targetMeasure}</dd></div>
                  <div><dt>Scope</dt><dd>{selected.scope}</dd></div>
                  <div><dt>Baseline</dt><dd>{selected.initialCoverPercent.toFixed(3)}% in {selected.baselineYear} ({selected.request.coralBaseline.surveySource})</dd></div>
                  <div><dt>Forecast ending year</dt><dd>{selected.forecastEndYear ?? selected.baselineYear + selected.horizonYears} ({selected.horizonYears} years)</dd></div>
                  <div><dt>Final interval mean</dt><dd>{selected.finalIntervalMeanPercent.toFixed(3)}%</dd></div>
                  <div><dt>Solver</dt><dd>{selected.solver.method.toUpperCase()}, {selected.solver.substepsPerYear} substeps per year, {selected.solver.intervalMeanQuadrature} means</dd></div>
                  <div><dt>Idempotency key</dt><dd>{selected.idempotencyKey ?? 'not supplied'}</dd></div>
                  <div><dt>Consented location</dt><dd>{selected.request.consentedLocation ? 'stored as context only' : 'none'}</dd></div>
                </dl>

                <h3>Mathematical computation</h3>
                <p className="muted">The stored run uses dC/dt = rC(1 − C/K) − α max(0, T(t) − Tcrit)C − βV(t)C, with T(t) = T0 + γt and V(t) integrated continuously from the selected baseline year.</p>
                <dl className="detail-list">
                  <div><dt>Profile baseline</dt><dd>{selected.initialCoverPercent.toFixed(2)}% live coral cover at {selected.baselineYear}</dd></div>
                  <div><dt>Configuration baseline</dt><dd>{selected.modelConfigBaselineYear ?? selected.baselineYear}</dd></div>
                  <div><dt>Equation / model</dt><dd>{selected.equationVersion} / {selected.modelVersion}</dd></div>
                </dl>
                {selected.tourismGrowthPeriods && selected.tourismGrowthPeriods.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <caption>Tourism growth periods used by this run</caption>
                      <thead><tr><th>Start year</th><th>End year</th><th>g</th><th>Unit</th></tr></thead>
                      <tbody>{selected.tourismGrowthPeriods.map((period) => <tr key={`${period.startYear}-${period.endYear}`}><td>{period.startYear}</td><td>{period.endYear}</td><td>{period.growthRate}</td><td>{period.unit}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}

                <h3>Computation breakdown by year</h3>
                <p className="muted">Each row preserves the solver inputs, state values, environmental drivers, rate terms, and percentage-point contributions used for that year.</p>
                {selected.status !== 'unavailable' && <ComputationBreakdownTable annual={selected.annual} />}
                {selected.status !== 'unavailable' && <MathematicalBreakdown prediction={selected} />}

                {selected.status !== 'unavailable' && <><AnnualSeriesChart prediction={selected} />
                <h3>Annual output</h3>
                <AnnualTable annual={selected.annual} /></>}
                <h3>Parameters</h3>
                <ParameterTable parameters={selected.parameters} />
                <h3>Sources</h3>
                <SourceTable sources={selected.sources} />

                <h3>Reports on this run</h3>
                {reports.length === 0
                  ? <p className="muted">No report has been generated for this run yet.</p>
                  : <ul className="reference-list">{reports.map((report) => <li key={report.id}>{report.title} ({report.generatedBy})</li>)}</ul>}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
