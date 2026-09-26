import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ModelConfig, ModelStatus } from '@ccovert/shared';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';
import { dataApi, getErrorMessage, modelApi } from '../lib/api';

export function ResearcherPage(): JSX.Element {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [active, setActive] = useState<ModelConfig | null>(null);
  const [startYear, setStartYear] = useState('2006');
  const [endYear, setEndYear] = useState('2020');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    Promise.all([modelApi.status(), modelApi.versions()])
      .then(([statusResponse, versionsResponse]) => {
        setStatus(statusResponse.status);
        setActive(versionsResponse.versions.find((version) => version.active) ?? null);
      })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)));
  }, []);
  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    window.addEventListener('focus', load);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', load); };
  }, [load]);

  const downloadTemplate = async (): Promise<void> => {
    setError('');
    const first = Number(startYear); const last = Number(endYear);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1900 || last > 2200 || last < first || last - first > 100) {
      setError('Choose a start and end year between 1900 and 2200, with at most 101 annual rows.'); return;
    }
    try {
      const response = await fetch(`/api/v1/data-imports/template?startYear=${first}&endYear=${last}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Could not download the Excel template');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `ccovert-series-${first}-${last}.xlsx`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) { setError(getErrorMessage(downloadError)); }
  };

  const importWorkbook = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault(); setError(''); setMessage('');
    if (!file) { setError('Choose a completed Excel workbook.'); return; }
    setPending(true);
    try {
      const result = await dataApi.importWorkbook(file);
      setMessage(`Imported ${result.datasets.length} series: ${result.datasets.map((item) => `${item.label} (${item.temporalCoverage.firstYear}-${item.temporalCoverage.lastYear})`).join(', ')}.${result.warnings.length ? ` Warnings: ${result.warnings.join('; ')}` : ''}`);
      setFile(null); load();
    } catch (importError) { setError(getErrorMessage(importError)); }
    finally { setPending(false); }
  };

  return <AppShell><div className="page-container">
    <PageHeader eyebrow="Research workspace" title="Researcher dashboard" description="Manage sourced annual series and the active citywide model configuration." />
    {error && <Notice tone="danger" title="Research action failed">{error}</Notice>}
    {message && <Notice tone="success" title="Import complete">{message}</Notice>}
    <div className="dashboard-quadrant">
      <section className="panel dashboard-quadrant-card"><p className="eyebrow">Model</p><h2>Current configuration</h2>
        <p className="muted">{active ? `${active.version} · ${active.reviewStatus} · ${new Date(active.createdAt).toLocaleString()}` : 'No active configuration'}</p>
        <p>SST: {active?.sstDatasetId ? 'Selected' : 'No imported series selected'} · Arrivals: {active?.tourismDatasetId ? 'Selected' : 'No imported series selected'}</p>
        {active?.parameters.map((parameter) => <div className="researcher-parameter" key={parameter.key}><strong>{parameter.symbol}</strong><span>{parameter.value === null ? 'Missing' : `${parameter.value} ${parameter.unit}`}</span><small>{parameter.status}</small></div>)}
        <Link className="button button-primary" to="/model">Edit model and datasets</Link>
      </section>
      <section className="panel dashboard-quadrant-card"><p className="eyebrow">Import</p><h2>Annual series workbook</h2>
        <p className="muted">The template contains SST and tourist arrivals sheets. Years are generated from the chosen interval. Fill source metadata and values in either sheet, then upload the completed workbook.</p>
        <div className="settings-grid"><label>Start year<input type="number" min="1900" max="2200" value={startYear} onChange={(event) => setStartYear(event.target.value)} /></label><label>End year<input type="number" min="1900" max="2200" value={endYear} onChange={(event) => setEndYear(event.target.value)} /></label></div>
        <div className="button-row"><button className="button button-secondary" type="button" onClick={() => void downloadTemplate()}>Download Excel template</button><Link className="button button-secondary" to="/data">Dataset library</Link></div>
        <form className="stack-form" onSubmit={importWorkbook}><label>Completed Excel workbook<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button className="button button-primary" disabled={pending} type="submit">{pending ? 'Importing…' : 'Import workbook'}</button></form>
      </section>
      <details className="panel researcher-disclosure"><summary>Missing parameters ({status?.missingParameters.length ?? 0})</summary>{status?.missingParameters.length ? status.missingParameters.map((item) => <p key={item.key}>{item.key}: {item.reason}</p>) : <p>No parameter values are missing from the active profile.</p>}</details>
      <details className="panel researcher-disclosure"><summary>Paper conflicts ({status?.paperConflicts.length ?? 0})</summary>{status?.paperConflicts.map((item) => <p key={item.id}><strong>{item.title}</strong><br />{item.detail}</p>)}</details>
    </div>
  </div></AppShell>;
}
