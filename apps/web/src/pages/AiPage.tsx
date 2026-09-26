import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AiReport, PredictionRecord } from '@ccovert/shared';
import { aiApi, getErrorMessage, predictionsApi, uploadsApi } from '../lib/api';
import { AppShell, PageHeader } from '../components/AppShell';
import { EmptyState, Notice } from '../components/States';
import { ConditionBadge, WarningList } from '../components/ReferenceChart';

export function AiPage(): JSX.Element {
  const [params] = useSearchParams();
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [reports, setReports] = useState<AiReport[]>([]);
  const [selectedPredictions, setSelectedPredictions] = useState<string[]>(params.get('prediction') ? [params.get('prediction') as string] : []);
  const [selectedUploads, setSelectedUploads] = useState<string[]>([]);
  const [active, setActive] = useState<AiReport | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(() => {
    predictionsApi.list(200).then((response) => setPredictions(response.predictions)).catch(() => setPredictions([]));
    aiApi.reports().then((response) => setReports(response.reports)).catch(() => setReports([]));
  }, []);

  useEffect(load, [load]);

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
        uploadIds: selectedUploads,
      });
      setActive(response.report);
      setReports((current) => [response.report, ...current]);
    } catch (generateError) {
      setError(getErrorMessage(generateError));
    } finally {
      setPending(false);
    }
  };

  const uploadDocument = async (file: File): Promise<void> => {
    setError('');
    setUploading(true);
    try {
      const response = await uploadsApi.upload(file);
      setSelectedUploads((current) => current.includes(response.upload.id) ? current : [...current, response.upload.id]);
      load();
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  };

  const dropFile = (event: React.DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadDocument(file);
  };

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          eyebrow="Reports"
          title="AI reports"
          description="Drop a report or choose saved prediction history. CCOverT will interpret only the evidence you select."
        />

        {error && <Notice tone="danger" title="Report request failed">{error}</Notice>}

        <div className="ai-layout">
          <form className="form-panel ai-builder" onSubmit={generate} noValidate>
            <fieldset disabled={pending}>
              <div className="ai-source-grid">
                <label
                  className={`upload-dropzone ${dragging ? 'is-dragging' : ''}`}
                  htmlFor="document"
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={dropFile}
                >
                  <span className="material-symbols-rounded upload-dropzone-icon" aria-hidden="true">upload_file</span>
                  <strong>{uploading ? 'Uploading file' : 'Drop a report here'}</strong>
                  <span className="muted">PDF, TXT, CSV, or JSON</span>
                  <span className="button button-small button-secondary">Choose a file</span>
                  <input id="document" type="file" accept=".pdf,.txt,.csv,.json" disabled={uploading}
                    onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); }} />
                </label>

                <div className="prediction-history-picker">
                  <div className="panel-heading"><div><p className="eyebrow">Evidence</p><h2>Select prediction history</h2></div></div>
                  {predictions.length === 0 && <EmptyState title="No saved predictions">
                    <p>Run a prediction first, or drop a report to analyze its contents.</p>
                    <Link className="button button-primary" to="/predict">Run a prediction</Link>
                  </EmptyState>}
                  <div className="reference-list">
                    {predictions.map((prediction) => (
                      <label className="checkbox-field" key={prediction.predictionId} htmlFor={`prediction-${prediction.predictionId}`}>
                        <input
                          id={`prediction-${prediction.predictionId}`}
                          type="checkbox"
                          checked={selectedPredictions.includes(prediction.predictionId)}
                          onChange={() => toggle(selectedPredictions, prediction.predictionId, setSelectedPredictions)}
                        />
                        {prediction.baselineYear}-{prediction.baselineYear + prediction.horizonYears} &middot; {prediction.finalCoverPercent.toFixed(2)}%
                        {prediction.isDemo && <> <ConditionBadge label="DEMO" status="danger" /></>}
                        {prediction.isScenario && <> <ConditionBadge label="SCENARIO - exploratory" status="danger" /></>}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <p className="form-hint">Select at least one prediction or upload one file. Uploaded evidence is private to your account.</p>
              <button className="button button-primary button-wide" type="submit" disabled={pending || (selectedPredictions.length === 0 && selectedUploads.length === 0)}>
                {pending ? 'Analyzing evidence' : 'Analyze selected evidence'}
              </button>
            </fieldset>
          </form>

          <section className="report-panel">
            <div className="panel-heading"><div><p className="eyebrow">Output</p><h2>{active ? active.title : 'No report selected'}</h2></div></div>
            {active && (
              <>
                <p className="muted">
                  Generated by {active.generatedBy}
                  {active.model ? ` (${active.model})` : ''} on {new Date(active.createdAt).toLocaleString()}
                </p>
                <WarningList warnings={active.warnings} title="Report warnings" />
                <div className="report-content">
                  {active.body.split('\n').map((line, index) => (
                    line.startsWith('# ') || line.startsWith('## ')
                      ? <h3 key={index}>{line.replace(/^#+ /, '')}</h3>
                      : line.startsWith('- ')
                        ? <p className="muted" key={index}>&bull; {line.slice(2)}</p>
                        : <p key={index}>{line}</p>
                  ))}
                </div>
                {active.citations.length > 0 && (
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
            {!active && reports.length === 0 && <p className="muted">Generated reports are listed below and stay available for download.</p>}
          </section>
        </div>

        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Library</p><h2>Previous reports</h2></div></div>
          {reports.length === 0 ? <p className="muted">No reports yet.</p> : (
            <div className="record-list">
              {reports.map((report) => (
                <article className="record-grid" key={report.id}>
                  <div>
                    <ConditionBadge label={report.generatedBy} status={report.generatedBy === 'ai-provider' ? 'good' : 'warning'} />
                    <p className="muted">{new Date(report.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <h3>{report.title}</h3>
                    <p className="muted">
                      {report.referencedPredictionIds.length} prediction(s), {report.referencedUploadIds.length} document(s), {report.citations.length} citation(s)
                    </p>
                    <button className="button button-small button-secondary" type="button" onClick={() => setActive(report)}>Open</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
