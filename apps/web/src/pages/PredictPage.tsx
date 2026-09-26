import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PredictionRecord } from '@ccovert/shared';
import { SCENARIO_DISCLAIMER, SCENARIO_LABEL, SOLVER_DEFAULTS, STUDY_AREA, TARGET_MEASURE } from '@ccovert/shared';
import { getErrorMessage, isNotConfigured, newIdempotencyKey, predictionsApi, type ScenarioAssumptionForm } from '../lib/api';
import { useModelStatus } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';
import { AnnualTable, ConditionBadge, WarningList } from '../components/ReferenceChart';
import { requestBrowserLocation } from '../lib/location';

interface FormState {
  profile: 'paper' | 'demo' | 'scenario';
  coverPercent: string;
  baselineYear: string;
  horizonYears: string;
  surveySource: string;
  substepsPerYear: string;
  shareLocation: boolean;
  assumedAlpha: string;
  assumedAlphaUnit: string;
  assumedAlphaRationale: string;
  assumedAlphaMin: string;
  assumedAlphaMax: string;
  assumedG: string;
  assumedGUnit: string;
  assumedGRationale: string;
  assumedGMin: string;
  assumedGMax: string;
}

const initialForm = (): FormState => ({
  profile: 'paper',
  coverPercent: '',
  baselineYear: '2006',
  horizonYears: '10',
  surveySource: '',
  substepsPerYear: String(SOLVER_DEFAULTS.substepsPerYear),
  shareLocation: false,
  assumedAlpha: '',
  assumedAlphaUnit: 'per degC per year',
  assumedAlphaRationale: '',
  assumedAlphaMin: '',
  assumedAlphaMax: '',
  assumedG: '',
  assumedGUnit: 'per year',
  assumedGRationale: '',
  assumedGMin: '',
  assumedGMax: ''
});

/**
 * Parameters the paper leaves unspecified. Only these can be assumed, because
 * every other required value either comes from the paper or an imported series.
 */
const ASSUMABLE_KEYS = [
  { key: 'alpha', symbol: '\u03b1', label: 'alpha', unit: 'per degC per year', rate: 'thermal mortality' },
  { key: 'g', symbol: 'g', label: 'g', unit: 'per year', rate: 'tourism growth' }
] as const;

interface AssumedDraft {
  value: string;
  unit: string;
  rationale: string;
  min: string;
  max: string;
}

const assumptionDrafts = (form: FormState): Record<string, AssumedDraft> => ({
  alpha: {
    value: form.assumedAlpha,
    unit: form.assumedAlphaUnit,
    rationale: form.assumedAlphaRationale,
    min: form.assumedAlphaMin,
    max: form.assumedAlphaMax
  },
  g: {
    value: form.assumedG,
    unit: form.assumedGUnit,
    rationale: form.assumedGRationale,
    min: form.assumedGMin,
    max: form.assumedGMax
  }
});

const setAssumption = (
  form: FormState,
  key: 'alpha' | 'g',
  field: keyof AssumedDraft,
  value: string
): FormState => {
  const prefixes: Record<'alpha' | 'g', Record<keyof AssumedDraft, keyof FormState>> = {
    alpha: {
      value: 'assumedAlpha',
      unit: 'assumedAlphaUnit',
      rationale: 'assumedAlphaRationale',
      min: 'assumedAlphaMin',
      max: 'assumedAlphaMax'
    },
    g: {
      value: 'assumedG',
      unit: 'assumedGUnit',
      rationale: 'assumedGRationale',
      min: 'assumedGMin',
      max: 'assumedGMax'
    }
  };
  return { ...form, [prefixes[key][field]]: value };
};

const numeric = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export function PredictPage(): JSX.Element {
  const { status, missingKeys } = useModelStatus();
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<PredictionRecord | null>(null);
  const [error, setError] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [pending, setPending] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    idempotencyKey.current = newIdempotencyKey();
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const [assumptionErrors, setAssumptionErrors] = useState<Record<string, string>>({});

  const runPrediction = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setBlockedReason('');
    setAssumptionErrors({});
    // A failed retry must not leave the previous output looking like the new
    // run. The server is the only source of a fresh result.
    setResult(null);
    setLocationNote('');
    if (!form.surveySource.trim()) {
      setError('Name the survey or report the baseline cover came from.');
      return;
    }

    // A scenario run must say what it assumed, so this is validated in the
    // browser too: the server rejects it either way.
    const assumedValues: ScenarioAssumptionForm[] = [];
    if (form.profile === 'scenario') {
      const drafts = assumptionDrafts(form);
      const problems: Record<string, string> = {};
      for (const candidate of ASSUMABLE_KEYS) {
        const draft = drafts[candidate.key];
        const value = numeric(draft.value);
        const rationale = draft.rationale.trim();
        // A value that is already configured does not need an assumption, and
        // one supplied for it is ignored by the model. So a blank field is
        // only an error when the parameter is actually missing.
        const isMissing = missingKeys.includes(candidate.key);
        // The API decides whether alpha is needed for the requested SST
        // horizon. A blank alpha is therefore allowed through this browser
        // check; a crossing horizon is refused server-side with a recoverable
        // missing-parameter error.
        const alphaMayBeInactive = candidate.key === 'alpha' && isMissing;
        if (value === null) {
          if (isMissing && !alphaMayBeInactive) {
            problems[candidate.key] = 'Enter a value to assume, or activate a configuration that supplies it.';
          }
          continue;
        }
        if (!rationale) {
          problems[candidate.key] = 'Explain why you chose this value.';
          continue;
        }
        const min = numeric(draft.min);
        const max = numeric(draft.max);
        if ((min === null) !== (max === null)) {
          problems[candidate.key] = 'Give both ends of the range, or neither.';
          continue;
        }
        if (min !== null && max !== null && min > max) {
          problems[candidate.key] = 'The range must not run backwards.';
          continue;
        }
        if (min !== null && max !== null && (value < min || value > max)) {
          problems[candidate.key] = `The value must lie inside ${min} to ${max}.`;
          continue;
        }
        assumedValues.push({
          key: candidate.key,
          value,
          unit: draft.unit.trim() || candidate.unit,
          rationale,
          range: min !== null && max !== null ? { min, max } : null
        });
      }
      if (Object.keys(problems).length > 0) {
        setAssumptionErrors(problems);
        setError('Every assumed value needs a number and a rationale before the scenario can run.');
        return;
      }
      if (assumedValues.length === 0) {
        setError('A scenario run must assume at least one value, so name the value you are exploring.');
        return;
      }
    }

    setPending(true);
    try {
      const consentedLocation = form.shareLocation && navigator.geolocation
        ? await requestBrowserLocation()
          .then((position) => ({
            latitude: position.latitude,
            longitude: position.longitude,
            accuracyMeters: position.accuracyMeters ?? null,
            consentedAt: new Date().toISOString(),
            contextOnly: true as const
          }))
          .catch(() => {
            setLocationNote('Location was not shared. The run continues without it.');
            return null;
          })
        : null;
      const response = await predictionsApi.create({
        profile: form.profile,
        baselineYear: Number(form.baselineYear),
        horizonYears: Number(form.horizonYears),
        coverPercent: Number(form.coverPercent),
        surveySource: form.surveySource.trim(),
        sstDatasetId: null,
        tourismDatasetId: null,
        consentedLocation,
        substepsPerYear: Number(form.substepsPerYear),
        assumedValues
      }, idempotencyKey.current);
      setResult(response.prediction);
      idempotencyKey.current = newIdempotencyKey();
    } catch (runError) {
      if (isNotConfigured(runError)) setBlockedReason(getErrorMessage(runError));
      else setError(getErrorMessage(runError));
    } finally {
      setPending(false);
    }
  };

  const demoAllowed = Boolean(status?.demoProfileAvailable);

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          eyebrow="Projection"
          title="Run a prediction"
          description={`${STUDY_AREA.label} annual average live coral cover (${TARGET_MEASURE}). Citywide scope only.`}
        />

        {blockedReason && <Notice tone="unavailable" title="The model refused this run">{blockedReason}</Notice>}
        {error && <Notice tone="danger" title="Check the inputs">{error}</Notice>}
        {locationNote && <Notice tone="info" title="Location">{locationNote}</Notice>}

        <div className="prediction-layout">
          <form className="form-panel" onSubmit={runPrediction} noValidate>
            <fieldset disabled={pending}>
              <div className="panel-heading"><div><p className="eyebrow">Inputs</p><h2>Baseline and horizon</h2></div></div>

              <label htmlFor="coverPercent">
                Baseline live coral cover (%)
                <input id="coverPercent" type="number" min="0" max="100" step="0.01" value={form.coverPercent}
                  onChange={(event) => update('coverPercent', event.target.value)} required />
              </label>
              <p className="form-hint form-hint-spaced">Enter a dated citywide source. The paper reports conflicting baseline values, so none is selected as fact.</p>

              <div className="settings-grid">
                <label htmlFor="baselineYear">
                  Baseline year
                  <input id="baselineYear" type="number" min="1900" max="2100" step="1" value={form.baselineYear}
                    onChange={(event) => update('baselineYear', event.target.value)} required />
                </label>
                <label htmlFor="horizonYears">
                  Years to project
                  <input id="horizonYears" type="number" min="1" max="100" step="1" value={form.horizonYears}
                    onChange={(event) => update('horizonYears', event.target.value)} required />
                </label>
              </div>

              <label htmlFor="surveySource">
                Baseline source
                <input id="surveySource" type="text" maxLength={400} placeholder="Survey or report, citywide, with year"
                  value={form.surveySource} onChange={(event) => update('surveySource', event.target.value)} required />
              </label>
              <p className="form-hint">
                Reef-site surveys are not interchangeable with the citywide scope. Confirm the scope matches before saving.
              </p>

              <label htmlFor="profile">
                Run mode
                <select id="profile" value={form.profile} onChange={(event) => update('profile', event.target.value as FormState['profile'])}>
                  <option value="paper">Paper profile</option>
                  <option value="scenario">Scenario</option>
                  <option value="demo" disabled={!demoAllowed}>Demo</option>
                </select>
              </label>

              {form.profile === 'scenario' && (
                <>
                  <div className="panel-heading"><div><p className="eyebrow">Exploratory run</p><h2>Assumed values</h2></div></div>
                  <Notice tone="unavailable" title={SCENARIO_LABEL}>
                    <p>
                      The model needs a value for every parameter it uses before it can run. A scenario lets you supply
                      missing values yourself; alpha can be left blank only when SST stays at or below Tcrit for the
                      full horizon. The result is stored as an assumption with your rationale attached, excluded from
                      validated prediction counts, and labelled in any report that includes it.
                    </p>
                  </Notice>
                  {ASSUMABLE_KEYS.map((candidate) => {
                    const draft = assumptionDrafts(form)[candidate.key];
                    const problem = assumptionErrors[candidate.key];
                    const isMissing = missingKeys.includes(candidate.key);
                    return (
                      <fieldset key={candidate.key} className="assumption-group">
                        <legend>{candidate.symbol} = {candidate.label} ({candidate.unit})</legend>
                        <p className="form-hint">
                          {isMissing && candidate.key === 'alpha'
                            ? 'No alpha is configured. Leave this blank only when SST stays at or below Tcrit for the full horizon; otherwise the API will require an explicit scenario alpha.'
                            : isMissing
                              ? `This scenario must supply a value for the ${candidate.rate} term.`
                            : `${candidate.label} is already configured, so leave this blank. Anything entered here is ignored and recorded as not applied.`}
                        </p>
                        <div className="settings-grid">
                          <label htmlFor={`assumed-${candidate.key}`}>
                            Assumed value
                            <input id={`assumed-${candidate.key}`} type="number" step="any" value={draft.value}
                              onChange={(event) => setForm((current) => setAssumption(current, candidate.key, 'value', event.target.value))} />
                          </label>
                          <label htmlFor={`assumed-${candidate.key}-unit`}>
                            Unit
                            <input id={`assumed-${candidate.key}-unit`} type="text" maxLength={120} value={draft.unit}
                              onChange={(event) => setForm((current) => setAssumption(current, candidate.key, 'unit', event.target.value))} />
                          </label>
                        </div>
                        <label htmlFor={`assumed-${candidate.key}-rationale`}>
                          Why this value
                          <input id={`assumed-${candidate.key}-rationale`} type="text" maxLength={600}
                            placeholder="Literature range, expert judgement, or a what-if"
                            value={draft.rationale}
                            onChange={(event) => setForm((current) => setAssumption(current, candidate.key, 'rationale', event.target.value))} />
                        </label>
                        <div className="settings-grid">
                          <label htmlFor={`assumed-${candidate.key}-min`}>
                            Plausible minimum (optional)
                            <input id={`assumed-${candidate.key}-min`} type="number" step="any" value={draft.min}
                              onChange={(event) => setForm((current) => setAssumption(current, candidate.key, 'min', event.target.value))} />
                          </label>
                          <label htmlFor={`assumed-${candidate.key}-max`}>
                            Plausible maximum (optional)
                            <input id={`assumed-${candidate.key}-max`} type="number" step="any" value={draft.max}
                              onChange={(event) => setForm((current) => setAssumption(current, candidate.key, 'max', event.target.value))} />
                          </label>
                        </div>
                        {problem && <p className="field-error">{problem}</p>}
                      </fieldset>
                    );
                  })}
                  <p className="form-hint">
                    Leave a value blank to use the configured one, or for alpha when the thermal term is inactive across
                    the requested horizon. An assumption never overwrites a value that already comes from the paper or
                    an imported series.
                  </p>
                </>
              )}

              <label className="checkbox-field" htmlFor="shareLocation">
                <input id="shareLocation" type="checkbox" checked={form.shareLocation} onChange={(event) => update('shareLocation', event.target.checked)} />
                Attach my consented location as context (never a model input)
              </label>

              <button className="button button-primary button-wide" type="submit" disabled={pending}>
                {pending
                  ? 'Running the model'
                  : form.profile === 'demo'
                    ? 'Run Demo Prediction'
                    : form.profile === 'scenario'
                      ? 'Run Scenario'
                      : 'Run prediction'}
              </button>
            </fieldset>
          </form>

          <section className="result-panel">
            <div className="panel-heading"><div><p className="eyebrow">Result</p><h2>Projection</h2></div></div>
            {!result && <p className="muted">Run the model to see the annual prediction table.</p>}
            {result && (
              <>
                <div className="card-kicker">
                  <span>{result.targetMeasure}</span>
                  {result.isDemo
                    ? <ConditionBadge label="DEMO - synthetic" status="danger" />
                    : result.isScenario
                      ? <ConditionBadge label={SCENARIO_LABEL} status="warn" />
                      : <ConditionBadge label="Model projection" status="good" />}
                </div>
                {result.isScenario && <Notice tone="unavailable" title={SCENARIO_LABEL}>{result.warnings[0] ?? SCENARIO_DISCLAIMER}</Notice>}
                <p className="prediction-number">{result.finalCoverPercent.toFixed(2)}%</p>
                <p className="muted">
                  From {result.initialCoverPercent.toFixed(2)}% in {result.baselineYear} to the end of {result.baselineYear + result.horizonYears}
                  {' '}({(result.finalCoverPercent - result.initialCoverPercent).toFixed(2)} percentage points).
                </p>
                <div className="prediction-table-heading">
                  <div><p className="eyebrow">Annual output</p><h3>Prediction table</h3></div>
                  <span className="muted">End-of-year states and interval means</span>
                </div>
                <AnnualTable annual={result.annual} />
                <WarningList warnings={result.warnings} />
                <div className="button-row">
                  <Link className="button button-small button-secondary" to={`/history?prediction=${result.predictionId}`}>Open in history</Link>
                  <a className="button button-small button-secondary" href={`/api/v1/predictions/${result.predictionId}/download?format=markdown`}>Download report</a>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
