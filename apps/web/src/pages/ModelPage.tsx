import { useCallback, useEffect, useState } from 'react';
import type { EnvironmentalDataset, ModelConfig, ModelParameter } from '@ccovert/shared';
import { CONDITION_CONVENTION, REQUIRED_PARAMETER_KEYS, SOLVER_DEFAULTS } from '@ccovert/shared';
import { dataApi, getErrorMessage, modelApi } from '../lib/api';
import { useAuth, useModelStatus } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { LoadingState, Notice } from '../components/States';
import { ModelStatusBanner } from '../components/ModelStatusBanner';
import { ConditionBadge, ParameterTable, WarningList } from '../components/ReferenceChart';

export function ModelPage(): JSX.Element {
  const { user } = useAuth();
  const { status, refresh } = useModelStatus();
  const [versions, setVersions] = useState<ModelConfig[]>([]);
  const [datasets, setDatasets] = useState<EnvironmentalDataset[]>([]);
  const [sstDatasetId, setSstDatasetId] = useState('');
  const [tourismDatasetId, setTourismDatasetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [sourceDatasetIds, setSourceDatasetIds] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const canEdit = user?.role === 'researcher';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([modelApi.versions(), dataApi.list()])
      .then(([response, data]) => {
        setVersions(response.versions);
        setDatasets(data.datasets);
        const active = response.versions.find((version) => version.active);
        setSstDatasetId(active?.sstDatasetId ?? '');
        setTourismDatasetId(active?.tourismDatasetId ?? '');
      })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const onFocus = (): void => { load(); void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, refresh]);

  const publish = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const baseVersion = status?.activeModelConfigVersion;
    if (!baseVersion) {
      setError('There is no active configuration to build on.');
      return;
    }
    const numeric: Record<string, number> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value.trim() === '') continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        setError(`${key} must be a finite number.`);
        return;
      }
      numeric[key] = parsed;
    }
    const active = versions.find((version) => version.active);
    if (Object.keys(numeric).length === 0 && sstDatasetId === (active?.sstDatasetId ?? '') && tourismDatasetId === (active?.tourismDatasetId ?? '')) {
      setError('Change a parameter or selected dataset before publishing.');
      return;
    }
    setPending(true);
    try {
      const response = await modelApi.createVersion({
        baseVersion,
        changes: numeric,
        notes,
        effectiveDate: null,
        reviewStatus: 'unreviewed',
        sourceDatasetIds: Object.keys(sourceDatasetIds).length > 0 ? sourceDatasetIds : undefined,
        sstDatasetId: sstDatasetId || null,
        tourismDatasetId: tourismDatasetId || null
      });
      setSuccess(`Published version ${response.version.version}. It is now the active configuration; earlier versions stay immutable.`);
      setChanges({});
      setNotes('');
      setSourceDatasetIds({});
      load();
      await refresh();
    } catch (publishError) {
      setError(getErrorMessage(publishError));
    } finally {
      setPending(false);
    }
  };

  const activeParameters: ModelParameter[] = status
    ? (versions.find((version) => version.version === status.activeModelConfigVersion)?.parameters ?? [])
    : [];

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          eyebrow="Model"
          title="Model status and configuration"
          description="What the equation needs, what it has, and who decided each value."
        />

        <ModelStatusBanner />
        {error && <Notice tone="danger" title="Request failed">{error}</Notice>}
        {success && <Notice tone="success" title="Configuration published">{success}</Notice>}

        {loading && <LoadingState label="Loading model configuration" />}

        {status && (
          <>
            <section className="panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Readiness</p><h2>Can the model run?</h2></div>
                <ConditionBadge label={status.configured ? 'Configured' : 'Not configured'} status={status.configured ? 'good' : 'danger'} />
              </div>
              <dl className="detail-list">
                <div><dt>Internal model service</dt><dd>{status.service}</dd></div>
                <div><dt>Equation version</dt><dd>{status.equationVersion ?? 'unreachable'}</dd></div>
                <div><dt>Model version</dt><dd>{status.modelVersion ?? 'unreachable'}</dd></div>
                <div><dt>Active configuration</dt><dd>{status.activeModelConfigVersion ?? 'none'}</dd></div>
                <div><dt>Active profile</dt><dd>{status.activeProfile ?? 'none'}</dd></div>
                <div><dt>Demo profile available</dt><dd>{status.demoProfileAvailable ? 'yes, synthetic values' : 'no'}</dd></div>
                <div><dt>Solver</dt><dd>{status.solver.method.toUpperCase()}, {status.solver.substepsPerYear} substeps/year, {status.solver.intervalMeanQuadrature} interval means, {status.solver.stateOutput}</dd></div>
                <div><dt>Study area</dt><dd>{status.studyArea.label} ({status.studyArea.scope})</dd></div>
              </dl>
              <p className="muted">{status.message}</p>
            </section>

            {status.missingParameters.length > 0 && (
              <details className="panel researcher-disclosure">
                <summary>Parameters with no value ({status.missingParameters.length})</summary>
                <div className="record-list">
                  {status.missingParameters.map((parameter) => (
                    <article className="record-grid" key={parameter.key}>
                      <div><ConditionBadge label={parameter.key} status="danger" /></div>
                      <div>
                        <h3>{parameter.reason}</h3>
                        <p>Required by: {parameter.requiredBy}</p>
                        {parameter.note && <p className="muted">{parameter.note}</p>}
                      </div>
                    </article>
                  ))}
                </div>
                <p className="muted">No placeholder value is ever used. The equation stays disabled until a researcher publishes a value with a source.</p>
              </details>
            )}

            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Parameters</p><h2>Active values</h2></div></div>
              <ParameterTable parameters={activeParameters.length > 0 ? activeParameters : status.missingParameters.map((parameter) => ({
                key: parameter.key,
                symbol: parameter.key,
                value: null,
                unit: '',
                status: 'unspecified-in-paper' as const,
                description: parameter.reason,
                provenance: 'Not configured',
                reviewStatus: 'unreviewed' as const,
                effectiveDate: null,
                notes: parameter.note
              }))} />
              <p className="muted">Required parameters: {REQUIRED_PARAMETER_KEYS.join(', ')}.</p>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Conventions</p><h2>Condition bands</h2></div></div>
              <p className="muted">{CONDITION_CONVENTION.label}: {CONDITION_CONVENTION.source}</p>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Condition bands</caption>
                  <thead><tr><th scope="col">Class</th><th scope="col">From %</th><th scope="col">To %</th><th scope="col">Upper bound</th></tr></thead>
                  <tbody>
                    {CONDITION_CONVENTION.bands.map((band) => (
                      <tr key={band.label}>
                        <th scope="row">{band.label}</th>
                        <td>{band.minPercent}</td>
                        <td>{band.maxPercent}</td>
                        <td>{band.upperInclusive ? 'inclusive' : 'exclusive'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <details className="panel researcher-disclosure">
              <summary>Paper conflicts and limitations ({status.paperConflicts.length})</summary>
              <div className="record-list">
                {status.paperConflicts.map((conflict) => (
                  <article className="record-grid" key={conflict.id}>
                    <div><ConditionBadge label={conflict.severity} status={conflict.severity === 'warning' ? 'warning' : 'neutral'} /></div>
                    <div><h3>{conflict.title}</h3><p>{conflict.detail}</p></div>
                  </article>
                ))}
              </div>
            </details>

            {canEdit && (
              <form className="form-panel" onSubmit={publish} noValidate>
                <fieldset disabled={pending}>
                  <div className="panel-heading"><div><p className="eyebrow">Researcher</p><h2>Publish a new configuration version</h2></div></div>
                  <p className="form-hint">
                    Versions are immutable. A change creates a new version with your notes and, ideally, the dataset each value came from.
                    Base version: {status.activeModelConfigVersion ?? 'none'}.
                  </p>
                  <div className="settings-grid">
                    {REQUIRED_PARAMETER_KEYS.map((key) => (
                      <label key={key} htmlFor={`param-${key}`}>
                        {key}
                        <input
                          id={`param-${key}`}
                          type="number"
                          step="any"
                          value={changes[key] ?? ''}
                          onChange={(event) => setChanges((current) => ({ ...current, [key]: event.target.value }))}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="form-hint">Leave a field empty to inherit the current value. Defaults: {SOLVER_DEFAULTS.substepsPerYear} substeps per year.</p>
                  <div className="settings-grid">
                    <label htmlFor="configured-sst">Sea-surface temperature dataset
                      <select id="configured-sst" value={sstDatasetId} onChange={(event) => setSstDatasetId(event.target.value)}>
                        <option value="">No imported SST selected</option>
                        {datasets.filter((dataset) => dataset.kind === 'sst' && dataset.scope === 'citywide-annual-average' && dataset.status !== 'rejected').map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.label} ({dataset.temporalCoverage.firstYear}-{dataset.temporalCoverage.lastYear})</option>)}
                      </select>
                    </label>
                    <label htmlFor="configured-tourism">Annual tourist arrivals dataset
                      <select id="configured-tourism" value={tourismDatasetId} onChange={(event) => setTourismDatasetId(event.target.value)}>
                        <option value="">No imported arrivals selected</option>
                        {datasets.filter((dataset) => dataset.kind === 'tourism' && dataset.scope === 'citywide-annual-average' && dataset.status !== 'rejected').map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.label} ({dataset.temporalCoverage.firstYear}-{dataset.temporalCoverage.lastYear})</option>)}
                      </select>
                    </label>
                  </div>
                  <label htmlFor="dataset-alpha">
                    Source dataset for alpha (optional)
                    <input id="dataset-alpha" type="text" value={sourceDatasetIds.alpha ?? ''}
                      placeholder="dataset id" onChange={(event) => setSourceDatasetIds((current) => ({ ...current, alpha: event.target.value }))} />
                  </label>
                  <label htmlFor="dataset-g">
                    Source dataset for g (optional)
                    <input id="dataset-g" type="text" value={sourceDatasetIds.g ?? ''}
                      placeholder="dataset id" onChange={(event) => setSourceDatasetIds((current) => ({ ...current, g: event.target.value }))} />
                  </label>
                  <label htmlFor="notes">
                    Provenance notes
                    <textarea id="notes" rows={3} maxLength={2000} value={notes}
                      placeholder="Where these values come from, and any caveat a reader must know."
                      onChange={(event) => setNotes(event.target.value)} required />
                  </label>
                  <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Publishing' : 'Publish version'}</button>
                </fieldset>
              </form>
            )}

            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Configuration versions</h2></div></div>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Model configuration versions</caption>
                  <thead>
                    <tr><th scope="col">Version</th><th scope="col">Profile</th><th scope="col">Active</th><th scope="col">Review</th><th scope="col">Created</th><th scope="col">By</th><th scope="col">Notes</th><th scope="col">Actions</th></tr>
                  </thead>
                  <tbody>
                    {versions.map((version) => (
                      <tr key={version.id}>
                        <th scope="row">{version.version}</th>
                        <td>{version.profile}</td>
                        <td>{version.active ? 'yes' : 'no'}</td>
                        <td>{version.reviewStatus}</td>
                        <td>{new Date(version.createdAt).toLocaleDateString()}</td>
                        <td>{version.createdBy}</td>
                        <td>{version.notes}</td>
                        <td>{version.archivedAt ? 'Archived' : canEdit && !version.active ? <div className="button-row"><button className="button button-small button-secondary" type="button" onClick={() => void modelApi.activateVersion(version.id).then(() => { load(); void refresh(); }).catch((actionError: unknown) => setError(getErrorMessage(actionError)))}>Activate</button><button className="button button-small button-danger" type="button" onClick={() => void modelApi.archiveVersion(version.id).then(load).catch((actionError: unknown) => setError(getErrorMessage(actionError)))}>Archive</button></div> : 'Current'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {!status && !loading && <WarningList warnings={['Model status is unavailable. The internal service could not be reached.']} />}
      </div>
    </AppShell>
  );
}
