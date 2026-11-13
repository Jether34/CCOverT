import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AiReport, PredictionRecord } from '@ccovert/shared';
import { aiApi, getErrorMessage, predictionsApi } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { EmptyState, Notice } from '../components/States';
import { ConditionBadge, WarningList } from '../components/ReferenceChart';

export function AiPage(): JSX.Element {
  const [params] = useSearchParams();
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [reports, setReports] = useState<AiReport[]>([]);
  const [selectedPredictions, setSelectedPredictions] = useState<string[]>(params.get('prediction') ? [params.get('prediction') as string] : []);
  const [active, setActive] = useState<AiReport | null>(null);
  const reportContentRef = useRef<HTMLDivElement>(null);
  const [reportExpanded, setReportExpanded] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    predictionsApi.list(200).then((response) => setPredictions(response.predictions)).catch(() => setPredictions([]));
    aiApi.reports().then((response) => setReports(response.reports)).catch(() => setReports([]));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (reportContentRef.current) reportContentRef.current.scrollTop = 0;
  }, [active?.id]);

  const toggle = (values: string[], value: string, setter: (next: string[]) => void): void => {
    setter(values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]);
  };

  const generate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const response = await aiApi.createReport({
        predictionIds: selectedPredictions,
      });
      setActive(response.report);
      setReportExpanded(true);
      setReports((current) => [response.report, ...current]);
    } catch (generateError) {
      setError(getErrorMessage(generateError));
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell>
      <div className="page-container ai-page">
        {error && <Notice tone="danger" title="Report request failed">{error}</Notice>}

        <div className="ai-layout">
          <form className="form-panel ai-builder" onSubmit={generate} noValidate>
            <fieldset disabled={pending}>
              <div className="ai-step-heading"><span className="ai-step-number">01</span><div><p className="eyebrow">Step one · Evidence</p><h2>Select prediction runs</h2><p className="muted">Choose the saved results you want to interpret.</p></div></div>
              <div className="ai-source-grid">
                <div className="prediction-history-picker">
                  <div className="panel-heading"><div><p className="eyebrow">Saved runs</p><h2>Prediction history</h2></div><span className="condition-badge condition-good">{selectedPredictions.length} selected</span></div>
                  {predictions.length === 0 && <EmptyState title="No saved predictions">
                    <p>Run a prediction first to create an AI interpretation.</p>
                    <Link className="button button-primary" to="/predict">Run a prediction</Link>
                  </EmptyState>}
                  <div className="ai-prediction-list">
                    {predictions.map((prediction) => (
                      <label className="ai-prediction-card" key={prediction.predictionId} htmlFor={`prediction-${prediction.predictionId}`}>
                        <input
                          id={`prediction-${prediction.predictionId}`}
                          type="checkbox"
                          checked={selectedPredictions.includes(prediction.predictionId)}
                          onChange={() => toggle(selectedPredictions, prediction.predictionId, setSelectedPredictions)}
                        />
                        <span className="ai-prediction-card-body">
                          <span className="card-kicker">
                            <span>{prediction.targetMeasure}</span>
                            {prediction.isDemo
                              ? <ConditionBadge label="DEMO" status="danger" />
                              : prediction.isScenario
                                ? <ConditionBadge label="SCENARIO - exploratory" status="danger" />
                                : prediction.status === 'unavailable'
                                  ? <ConditionBadge label="Not completed" status="unavailable" />
                                  : <ConditionBadge label="Model projection" status="good" />}
                          </span>
                          <strong className="ai-prediction-value">{prediction.status === 'unavailable' ? 'Not completed' : `${prediction.finalCoverPercent.toFixed(2)}%`}</strong>
                          <span className="muted">{prediction.baselineYear} ({prediction.initialCoverPercent.toFixed(2)}%) to {prediction.baselineYear + prediction.horizonYears}</span>
                          <span className="muted">Created {new Date(prediction.createdAt).toLocaleDateString()}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <p className="form-hint">Select at least one saved prediction. Reports use only your prediction history.</p>
              <button className="button button-primary button-wide" type="submit" disabled={pending || selectedPredictions.length === 0}>
                {pending ? 'Generating report' : 'Generate report from selected evidence'}
              </button>
            </fieldset>
          </form>

          <section className={`report-panel ${active && !reportExpanded ? 'report-panel-collapsed' : ''}`}>
            <div className="ai-step-heading"><span className="ai-step-number">02</span><div><p className="eyebrow">Step two · Interpretation</p><h2>{active ? active.title : 'Your report will appear here'}</h2><p className="muted">Generate a report to see the interpretation, caveats, and citations.</p></div>{active && <button className="button button-small button-secondary" type="button" onClick={() => setReportExpanded((expanded) => !expanded)}>{reportExpanded ? 'Collapse report' : 'View full report'}</button>}</div>
            {active && (
              <>
                <p className="muted">
                  Generated by {active.generatedBy}
                  {active.model ? ` (${active.model})` : ''} on {new Date(active.createdAt).toLocaleString()}
                </p>
                {reportExpanded && <WarningList warnings={active.warnings} title="Report warnings" />}
                {reportExpanded && <div className="report-content" ref={reportContentRef}>
                  {active.body.split('\n').map((line, index) => (
                    line.startsWith('# ') || line.startsWith('## ')
                      ? <h3 key={index}>{line.replace(/^#+ /, '')}</h3>
                      : line.startsWith('- ')
                        ? <p className="muted" key={index}>&bull; {line.slice(2)}</p>
                        : <p key={index}>{line}</p>
                  ))}
                </div>}
                {reportExpanded && active.citations.length > 0 && (
                  <>
                    <h3>Citations</h3>
                    <ol className="reference-list">
                      {active.citations.map((citation, index) => (
                        <li key={`${citation.uploadId ?? citation.predictionId}-${index}`}>
                          {citation.filename ?? (citation.predictionId ? `Prediction ${citation.predictionId.slice(0, 8)}` : 'Source')}
                          {citation.page ? `, page ${citation.page}` : ''}: {citation.excerpt}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </>
            )}
            {!active && <div className="ai-report-empty"><span className="material-symbols-rounded" aria-hidden="true">auto_awesome</span><strong>Start with your evidence</strong><p>Choose at least one prediction on the left. Your report will be saved automatically.</p></div>}
          </section>
        <section className="panel ai-library">
          <div className="ai-step-heading"><span className="ai-step-number">03</span><div><p className="eyebrow">Your library</p><h2>Saved interpretations</h2><p className="muted">Reopen a previous report to review its evidence and findings.</p></div><span className="condition-badge condition-good">{reports.length} {reports.length === 1 ? 'report' : 'reports'}</span></div>
          {reports.length === 0 ? <p className="muted">No reports yet.</p> : (
            <div className="ai-library-list">
              {reports.map((report) => (
                <article
                  className={`ai-library-card${active?.id === report.id ? ' is-active' : ''}`}
                  key={report.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active?.id === report.id}
                  onClick={() => { setActive(report); setReportExpanded(true); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActive(report);
                      setReportExpanded(true);
                    }
                  }}
                >
                  <div className="ai-library-card-meta">
                    <ConditionBadge label={report.generatedBy === 'ai-provider' ? 'AI report' : 'Deterministic summary'} status={report.generatedBy === 'ai-provider' ? 'good' : 'warning'} />
                    <span className="muted">{new Date(report.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="ai-library-card-body">
                    <h3>{report.title}</h3>
                    <p className="muted">{report.referencedPredictionIds.length} prediction(s) · {report.referencedUploadIds.length} document(s) · {report.citations.length} citation(s)</p>
                    <span className="ai-library-open">Open report <span aria-hidden="true">→</span></span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </AppShell>
  );
}
