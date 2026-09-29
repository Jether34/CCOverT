import { useCallback, useEffect, useState } from 'react';
import type { ModelParameter } from '@ccovert/shared';
import { REQUIRED_PARAMETER_KEYS } from '@ccovert/shared';
import { getErrorMessage, modelApi } from '../lib/api';
import { useAuth, useModelStatus } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { LoadingState, Notice } from '../components/States';
import { ModelStatusBanner } from '../components/ModelStatusBanner';
import { ConditionBadge, ParameterTable, WarningList } from '../components/ReferenceChart';

const PAPER_REPRODUCTION_EDITOR_DEFAULTS: Record<string, string> = {
  alpha: '0.05',
  g: '0.128708'
};

/** Researcher control surface for the single active model configuration. */
export function ModelPage({ compact = false }: { compact?: boolean }): JSX.Element {
  const { user } = useAuth();
  const { status, refresh } = useModelStatus();
  const [parameters, setParameters] = useState<ModelParameter[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const canEdit = user?.role === 'researcher';

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await modelApi.parameters();
      setParameters(response.parameters);
      const nextValues: Record<string, string> = {};
      for (const parameter of response.parameters) {
        if (parameter.value !== null && Number.isFinite(parameter.value)) nextValues[parameter.key] = String(parameter.value);
        else if (PAPER_REPRODUCTION_EDITOR_DEFAULTS[parameter.key]) nextValues[parameter.key] = PAPER_REPRODUCTION_EDITOR_DEFAULTS[parameter.key];
      }
      setValues(nextValues);
      setSavedValues(Object.fromEntries(response.parameters
        .filter((parameter) => parameter.value !== null && Number.isFinite(parameter.value))
        .map((parameter) => [parameter.key, String(parameter.value)])));
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = (): void => { void load(); void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, refresh]);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const changes: Record<string, number> = {};
    for (const key of REQUIRED_PARAMETER_KEYS) {
      const raw = values[key]?.trim() ?? '';
      if (raw === '') continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        setError(`${key} must be a finite number.`);
        return;
      }
      if (raw !== savedValues[key]) changes[key] = parsed;
    }
    if (Object.keys(changes).length === 0) {
      setError('Change at least one parameter before saving.');
      return;
    }
    if (!notes.trim()) {
      setError('Add a short note describing the source or reason for this parameter update.');
      return;
    }
    setPending(true);
    try {
      const response = await modelApi.updateConfiguration({ changes, notes: notes.trim() });
      setSuccess(`Saved ${response.version.version}. This active model configuration is now used by all client predictions.`);
      setNotes('');
      await load();
      await refresh();
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader eyebrow="Model configuration" title="One model for every client" description="Edit the active model parameters. Saving applies the new values immediately to every client prediction." />
        {!compact && <ModelStatusBanner />}
        {error && <Notice tone="danger" title="Request failed">{error}</Notice>}
        {success && <Notice tone="success" title="Configuration saved">{success}</Notice>}
        {loading && <LoadingState label="Loading active model configuration" />}

        {!loading && status && (
          <>
            {!compact && <section className="panel model-single-config-summary">
              <div className="panel-heading">
                <div><p className="eyebrow">Active configuration</p><h2>Shared model settings</h2></div>
                <ConditionBadge label={status.configured ? 'Ready' : 'Needs parameters'} status={status.configured ? 'good' : 'warning'} />
              </div>
              <dl className="detail-list">
                <div><dt>Active version</dt><dd>{status.activeModelConfigVersion ?? 'none'}</dd></div>
                <div><dt>Profile</dt><dd>{status.activeProfile ?? 'none'}</dd></div>
                <div><dt>Equation</dt><dd>{status.equationVersion ?? 'unavailable'}</dd></div>
                <div><dt>Study area</dt><dd>{status.studyArea.label}</dd></div>
              </dl>
              <p className="muted">Baseline, forecast window, datasets, solver, and profile are inherited from this active configuration and are not separate researcher settings.</p>
            </section>}

            {!compact && <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Current values</p><h2>Model parameters</h2></div></div>
              <ParameterTable parameters={(parameters.length > 0 ? parameters : status.missingParameters.map((parameter) => ({ key: parameter.key, symbol: parameter.key, value: null, unit: '', status: 'unspecified-in-paper' as const, description: parameter.reason, provenance: 'Not configured', reviewStatus: 'unreviewed' as const, effectiveDate: null, notes: parameter.note }))).map((parameter) => parameter.value === null && PAPER_REPRODUCTION_EDITOR_DEFAULTS[parameter.key] ? { ...parameter, value: Number(PAPER_REPRODUCTION_EDITOR_DEFAULTS[parameter.key]) } : parameter)} />
            </section>}

            {canEdit && (
              <form className="form-panel" onSubmit={save} noValidate>
                <fieldset disabled={pending}>
                  <div className="panel-heading"><div><p className="eyebrow">Research control</p><h2>Edit active parameters</h2></div></div>
                  <p className="form-hint">Only numeric model parameters can be changed here. Alpha is initialized to 0.05 and the configured tourism growth value g to 0.128708; saving publishes these values to the single active configuration used by all users.</p>
                  <Notice tone="info" title="How to read parameter values">
                    <p>All model rates are expressed per year unless stated otherwise. They are applied by the yearly forecast solver (with numerical substeps inside each year), not as monthly observations.</p>
                    <ul>
                      <li><strong>r</strong>, <strong>alpha</strong>, <strong>gamma</strong>, and <strong>g</strong> are annual rates. Alpha is per °C per year; gamma is °C per year; g is tourism growth per year and is not a monthly value.</li>
                      <li><strong>T0</strong> and <strong>Tcrit</strong> are temperatures in °C. <strong>V0</strong> is tourist arrivals per year at the baseline. <strong>K</strong> is coral-cover capacity in percent. <strong>beta</strong> is the tourism-effect coefficient per arrival per year.</li>
                      <li>Values may be directly configured, sourced from research data, or derived from calculated annual series. The change note records the source or rationale; derived values are still applied using the units shown above.</li>
                    </ul>
                  </Notice>
                  <div className="settings-grid">
                    {REQUIRED_PARAMETER_KEYS.map((key) => (
                      <label key={key} htmlFor={`param-${key}`}>{key}<input id={`param-${key}`} type="number" step="any" value={values[key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>
                    ))}
                  </div>
                  <label htmlFor="notes">Change note<textarea id="notes" rows={3} maxLength={2000} value={notes} placeholder="Describe the source or reason for these parameter values." onChange={(event) => setNotes(event.target.value)} required /></label>
                  <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Saving parameters' : 'Save model parameters'}</button>
                </fieldset>
              </form>
            )}

            {!compact && status.missingParameters.length > 0 && <WarningList warnings={status.missingParameters.map((parameter) => `${parameter.key}: ${parameter.reason}`)} />}
          </>
        )}
        {!status && !loading && <WarningList warnings={['Model status is unavailable. The internal service could not be reached.']} />}
      </div>
    </AppShell>
  );
}
