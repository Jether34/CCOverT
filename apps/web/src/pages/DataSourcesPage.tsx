import { useCallback, useEffect, useState } from 'react';
import type { EnvironmentalDataset } from '@ccovert/shared';
import { dataApi, getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { EmptyState, Notice } from '../components/States';
import { ConditionBadge, WarningList } from '../components/ReferenceChart';

interface ImportForm {
  kind: 'sst' | 'tourism' | 'coral-cover';
  label: string;
  provider: string;
  sourceCitation: string;
  unit: string;
  scope: 'citywide-annual-average' | 'reef-site';
  spatialCoverage: string;
}

const unitFor = (kind: ImportForm['kind']): string =>
  kind === 'sst' ? 'degC' : kind === 'tourism' ? 'annualArrivals' : 'percent';

const emptyForm = (): ImportForm => ({
  kind: 'sst',
  label: '',
  provider: '',
  sourceCitation: '',
  unit: 'degC',
  scope: 'citywide-annual-average',
  spatialCoverage: 'Puerto Princesa City, Palawan'
});

const kindLabel: Record<ImportForm['kind'], string> = {
  sst: 'Sea-surface temperature (degC)',
  tourism: 'Tourist arrivals (annual, citywide)',
  'coral-cover': 'Observed coral cover (%)'
};

export function DataSourcesPage(): JSX.Element {
  const { user } = useAuth();
  const [datasets, setDatasets] = useState<EnvironmentalDataset[]>([]);
  const [form, setForm] = useState<ImportForm>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const canImport = user?.role === 'researcher' && Boolean(user.emailVerified);

  const load = useCallback(() => {
    dataApi.list().then((response) => setDatasets(response.datasets)).catch((loadError: unknown) => setError(getErrorMessage(loadError)));
  }, []);

  useEffect(load, [load]);

  const update = <K extends keyof ImportForm>(key: K, value: ImportForm[K]): void =>
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'kind') next.unit = unitFor(value as ImportForm['kind']);
      return next;
    });

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setWarnings([]);
    if (!file) {
      setError('Choose a CSV file with year and value columns.');
      return;
    }
    setPending(true);
    try {
      const response = await dataApi.import({ ...form, provider: form.provider || 'user-import' }, file);
      setWarnings(response.warnings);
      setSuccess(`Imported ${response.dataset.label}: ${response.dataset.temporalCoverage.yearCount} rows, ${response.dataset.temporalCoverage.firstYear}-${response.dataset.temporalCoverage.lastYear}.`);
      setForm(emptyForm());
      setFile(null);
      load();
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setPending(false);
    }
  };

  const estimateG = async (dataset: EnvironmentalDataset): Promise<void> => {
    setError('');
    setSuccess('');
    try {
      const response = await dataApi.estimateG(dataset.id);
      setSuccess(`Estimated g = ${response.dataset.derivedValue?.value} for ${response.dataset.label}. Create a model configuration version to use it.`);
      load();
    } catch (estimateError) {
      setError(getErrorMessage(estimateError));
    }
  };

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          eyebrow="Sourced inputs"
          title="Data sources"
          description="Import the sea-surface temperature, tourist arrivals, and observed cover series that back the model. Every series needs a citation."
        />

        {error && <Notice tone="danger" title="Import failed">{error}</Notice>}
        {success && <Notice tone="success" title="Done">{success}</Notice>}
        {warnings.length > 0 && <WarningList warnings={warnings} title="Import warnings" />}

        {!canImport && (
          <Notice tone="warning" title="Researcher access required">
            <p>Only verified researchers can import datasets or derive tourism growth values.</p>
          </Notice>
        )}

        <div className="prediction-layout">
          <form className="form-panel" onSubmit={submit} noValidate>
            <fieldset disabled={pending || !canImport}>
              <div className="panel-heading"><div><p className="eyebrow">New series</p><h2>Import a CSV</h2></div></div>
              <label htmlFor="kind">
                Series type
                <select id="kind" value={form.kind} onChange={(event) => update('kind', event.target.value as ImportForm['kind'])}>
                  {Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label htmlFor="label">
                Label
                <input id="label" type="text" maxLength={200} value={form.label}
                  placeholder={form.kind === 'sst' ? 'PAGASA-derived SST, citywide annual mean' : 'Series name'}
                  onChange={(event) => update('label', event.target.value)} required />
              </label>
              <label htmlFor="provider">
                Provider
                <input id="provider" type="text" maxLength={200} value={form.provider} placeholder="Agency or source"
                  onChange={(event) => update('provider', event.target.value)} />
              </label>
              <label htmlFor="sourceCitation">
                Source citation
                <input id="sourceCitation" type="text" maxLength={600} value={form.sourceCitation}
                  placeholder="Dataset title, publisher, year, and identifier or URL"
                  onChange={(event) => update('sourceCitation', event.target.value)} required />
              </label>
              <p className="form-hint">A citation is mandatory. Values without a source are rejected, not stored.</p>
              <div className="settings-grid">
                <label htmlFor="unit">
                  Unit
                  <input id="unit" type="text" maxLength={60} value={form.unit} onChange={(event) => update('unit', event.target.value)} required />
                </label>
                <label htmlFor="scope">
                  Spatial scope
                  <select id="scope" value={form.scope} onChange={(event) => update('scope', event.target.value as ImportForm['scope'])}>
                    <option value="citywide-annual-average">Citywide annual average</option>
                    <option value="reef-site">Reef site (not valid for this model)</option>
                  </select>
                </label>
              </div>
              <label htmlFor="spatialCoverage">
                Coverage description
                <input id="spatialCoverage" type="text" maxLength={300} value={form.spatialCoverage}
                  onChange={(event) => update('spatialCoverage', event.target.value)} required />
              </label>
              <label htmlFor="file">
                CSV file
                <input id="file" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
              </label>
              <p className="form-hint">
                The file needs a header row with <code>year</code> and <code>value</code> columns. Gaps, out-of-range SST values,
                and non-citywide scopes are accepted only with a warning and are marked as needing review.
              </p>
              <button className="button button-primary button-wide" type="submit" disabled={pending}>
                {pending ? 'Importing' : 'Import series'}
              </button>
            </fieldset>
          </form>

          <section className="result-panel">
            <div className="panel-heading"><div><p className="eyebrow">Library</p><h2>{datasets.length} series</h2></div></div>
            {datasets.length === 0 && <EmptyState title="No datasets imported">
              <p>The model cannot run with an unsourced temperature or tourism series. Import at least one of each, or accept unsourced warnings.</p>
            </EmptyState>}
            <div className="record-list">
              {datasets.map((dataset) => (
                <article className="record-grid" key={dataset.id}>
                  <div>
                    <ConditionBadge
                      label={dataset.status}
                      status={dataset.status === 'validated' ? 'good' : dataset.status === 'needs-review' ? 'warning' : 'danger'}
                    />
                    <p className="muted">{dataset.kind} &middot; {dataset.unit}</p>
                  </div>
                  <div>
                    <h3>{dataset.label}</h3>
                    <p className="muted">
                      {dataset.temporalCoverage.firstYear}-{dataset.temporalCoverage.lastYear} &middot; {dataset.temporalCoverage.yearCount} rows &middot; {dataset.scope}
                    </p>
                    <p>{dataset.sourceCitation}</p>
                    {dataset.derivedValue && (
                      <p>
                        Derived {dataset.derivedValue.key} = <strong>{dataset.derivedValue.value}</strong>
                        <span className="muted"> &middot; {dataset.derivedValue.method}</span>
                      </p>
                    )}
                    {dataset.kind === 'tourism' && canImport && !dataset.derivedValue && (
                      <button className="button button-small button-secondary" type="button" onClick={() => void estimateG(dataset)}>
                        Estimate g from annual arrivals
                      </button>
                    )}
                    {dataset.kind === 'tourism' && canImport && dataset.derivedValue && (
                      <button className="button button-small button-secondary" type="button" onClick={() => void estimateG(dataset)}>
                        Re-estimate g from arrivals
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
