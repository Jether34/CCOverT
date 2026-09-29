import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PaperBaselineOption, PredictionRecord } from '@ccovert/shared';
import {
  PAPER_BASELINE_OPTIONS,
  PAPER_REPRODUCTION_LABEL,
  PAPER_REPRODUCTION_TOURISM_PERIODS,
  SCENARIO_DISCLAIMER,
  SCENARIO_LABEL,
  SOLVER_DEFAULTS,
  STUDY_AREA,
  TARGET_MEASURE
} from '@ccovert/shared';
import { ApiRequestError, getErrorMessage, isNotConfigured, modelApi, newIdempotencyKey, predictionsApi, type ScenarioAssumptionForm } from '../lib/api';
import { useAuth, useModelStatus } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';
import { AnnualTable, ConditionBadge } from '../components/ReferenceChart';
import { requestBrowserLocation } from '../lib/location';

const OWN_SURVEY = 'my-own-survey';
const PAPER_REPRODUCTION_BASELINE_SOURCE = (year: string): string => `CCOverT paper-reproduction baseline, Puerto Princesa City, ${year}`;
const PAPER_REPRODUCTION_BASELINE_METHOD = 'Paper-reproduction configured citywide annual-average baseline';

interface FormState {
  profile: 'paper' | 'demo' | 'scenario' | 'paper-reproduction';
  baselineOptionId: string;
  coverPercent: string;
  baselineYear: string;
  horizonYears: string;
  forecastEndYear?: string;
  surveySource: string;
  surveyMethod: string;
  substepsPerYear: string;
  shareLocation: boolean;
  startDate?: string;
  endDate?: string;
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
  baselineOptionId: OWN_SURVEY,
  coverPercent: '',
  baselineYear: '2006',
  horizonYears: '10',
  forecastEndYear: '2016',
  surveySource: '',
  surveyMethod: '',
  substepsPerYear: String(SOLVER_DEFAULTS.substepsPerYear),
  shareLocation: false,
  startDate: '2006-01-01',
  endDate: '2016-12-31',
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

/**
 * Choosing a cited baseline fills the cover, year, source, and method together
 * so the number can never drift from the citation it is attributed to. The year
 * is embedded in the citation because the API rejects a baseline source without
 * one. Choosing "my own survey" clears them again so nothing is left implying
 * provenance that no longer applies.
 */
export const applyBaselineOption = (form: FormState, option: PaperBaselineOption | null): FormState =>
  option === null
    ? { ...form, baselineOptionId: OWN_SURVEY, coverPercent: '', surveySource: '', surveyMethod: '' }
    : {
      ...form,
      baselineOptionId: option.id,
      coverPercent: String(option.coverPercent),
      baselineYear: String(option.year),
      forecastEndYear: String(option.year + Number(form.horizonYears || 10)),
      surveySource: option.source,
      surveyMethod: option.method
    };

export const findBaselineOption = (id: string): PaperBaselineOption | null =>
  PAPER_BASELINE_OPTIONS.find((option) => option.id === id) ?? null;

export function PredictPage(): JSX.Element {
  const { status, missingKeys } = useModelStatus();
  const { user } = useAuth();
  // Researchers use the same client prediction experience. The researcher
  // role controls the shared parameters from its dashboard, not a separate
  // prediction profile or baseline workflow.
  const clientMode = user?.role === 'client' || user?.role === 'user' || user?.role === 'researcher';
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<PredictionRecord | null>(null);
  const [error, setError] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [pending, setPending] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const [configuredWindow, setConfiguredWindow] = useState({ startDate: '2006-01-01', endDate: '2016-12-31', baselineYear: 2006 });
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    idempotencyKey.current = newIdempotencyKey();
  }, []);

  useEffect(() => {
    if (clientMode) {
      setForm((current) => current.profile === 'paper-reproduction'
        ? current
        : {
          ...current,
          profile: 'paper-reproduction',
          baselineYear: '2006',
          coverPercent: '57',
          startDate: '2006-01-01',
          surveySource: current.surveySource || PAPER_REPRODUCTION_BASELINE_SOURCE(current.baselineYear),
          surveyMethod: current.surveyMethod || PAPER_REPRODUCTION_BASELINE_METHOD
        });
    }
  }, [clientMode]);

  useEffect(() => {
    void modelApi.parameters().then((configuration) => {
      const startDate = `${configuration.baselineYear}-01-01`;
      const endDate = `${configuration.baselineYear + configuration.horizonYears}-12-31`;
      setConfiguredWindow({ startDate, endDate, baselineYear: configuration.baselineYear });
      setForm((current) => current.profile === 'paper-reproduction'
        ? current
        : {
          ...current,
          baselineYear: String(configuration.baselineYear),
          horizonYears: String(configuration.horizonYears),
          forecastEndYear: String(configuration.baselineYear + configuration.horizonYears),
          coverPercent: String(configuration.initialCoverPercent),
          surveySource: configuration.initialCoverSource,
          surveyMethod: 'Researcher-configured citywide annual average baseline',
          startDate,
          endDate
        });
    }).catch(() => undefined);
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const updateClientDate = (key: 'startDate' | 'endDate', value: string): void => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      const baselineYear = Number(next.baselineYear);
      if (key === 'startDate') {
        const startYear = Number(value.slice(0, 4));
        const endYear = Number((next.forecastEndYear ?? next.endDate ?? configuredWindow.endDate).toString().slice(0, 4));
        if (Number.isFinite(startYear)) {
          next.baselineYear = String(startYear);
          next.startDate = value;
          if (Number.isFinite(endYear) && endYear > startYear) next.horizonYears = String(endYear - startYear);
        }
        return next;
      }
      const endYear = Number((next.endDate ?? configuredWindow.endDate).slice(0, 4));
      if (Number.isFinite(baselineYear) && Number.isFinite(endYear) && endYear > baselineYear) {
        next.forecastEndYear = String(endYear);
        next.horizonYears = String(endYear - baselineYear);
      }
      return next;
    });
  };

  const [assumptionErrors, setAssumptionErrors] = useState<Record<string, string>>({});
  const [blockedKeys, setBlockedKeys] = useState<string[]>([]);

  /**
   * A refusal is only useful if it names a way forward. When the paper profile
   * is blocked purely by parameters the paper never published, the only routes
   * are to switch to an explicit scenario or wait for a researcher to configure
   * them, so say that instead of leaving the user at a dead end.
   */
  const switchToScenario = (): void => {
    setForm((current) => ({ ...current, profile: 'scenario' }));
    setError('');
    setBlockedReason('');
    setBlockedKeys([]);
  };

  const runPrediction = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setBlockedReason('');
    setAssumptionErrors({});
    // A failed retry must not leave the previous output looking like the new
    // run. The server is the only source of a fresh result.
    setResult(null);
    setLocationNote('');
    const effectiveProfile = clientMode ? 'paper-reproduction' : form.profile;
    const surveySource = form.surveySource.trim() || (effectiveProfile === 'paper-reproduction' ? PAPER_REPRODUCTION_BASELINE_SOURCE(form.baselineYear) : '');
    const surveyMethod = form.surveyMethod.trim() || (effectiveProfile === 'paper-reproduction' ? PAPER_REPRODUCTION_BASELINE_METHOD : '');
    if (!surveySource) {
      setError('Name the survey or report the baseline cover came from.');
      return;
    }

    // A scenario run must say what it assumed, so this is validated in the
    // browser too: the server rejects it either way.
    const assumedValues: ScenarioAssumptionForm[] = [];
    if (effectiveProfile === 'scenario') {
      const drafts = assumptionDrafts(form);
      const problems: Record<string, string> = {};
      for (const candidate of ASSUMABLE_KEYS.filter((item) => form.profile === 'scenario' || item.key === 'alpha')) {
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
        setError('Every explicit assumption needs a number and a rationale before the run can start.');
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
        profile: effectiveProfile,
        baselineYear: Number(form.baselineYear),
        horizonYears: Number(form.horizonYears),
        forecastEndYear: Number(form.forecastEndYear ?? Number(form.baselineYear) + Number(form.horizonYears)),
        coverPercent: Number(form.coverPercent),
        coralBaselineYear: Number(form.baselineYear),
        surveySource: effectiveProfile === 'paper-reproduction' ? PAPER_REPRODUCTION_BASELINE_SOURCE(form.baselineYear) : surveySource,
        surveyMethod,
        sstDatasetId: null,
        tourismDatasetId: null,
        consentedLocation,
        substepsPerYear: Number(form.substepsPerYear),
        assumedValues
      }, idempotencyKey.current);
      setResult(response.prediction);
      idempotencyKey.current = newIdempotencyKey();
    } catch (runError) {
      if (runError instanceof ApiRequestError && runError.prediction) {
        setResult(runError.prediction);
      }
      if (isNotConfigured(runError)) {
        setBlockedReason(getErrorMessage(runError));
        setBlockedKeys(status?.missingParameters.map((parameter) => parameter.key) ?? []);
      } else {
        setError(getErrorMessage(runError));
      }
    } finally {
      setPending(false);
    }
  };

  const demoAllowed = Boolean(status?.demoProfileAvailable);
  const selectedBaseline = findBaselineOption(form.baselineOptionId);

  return (
    <AppShell>
      <div className="page-container predict-page">
        <PageHeader
          eyebrow="Projection"
          title="Run a prediction"
          description={`${STUDY_AREA.label} annual average live coral cover (${TARGET_MEASURE}). Citywide scope only.`}
        />

        <div className="prediction-layout">
          <form className="form-panel" onSubmit={runPrediction} noValidate>
            <fieldset disabled={pending}>
              <div className="panel-heading"><div><p className="eyebrow">Inputs</p><h2>Baseline and horizon</h2></div></div>

              {!clientMode && <fieldset className="baseline-options">
                <legend>Where the baseline cover comes from</legend>
                <p className="form-hint">
                  The paper prints several different figures for {STUDY_AREA.label} in 2006, so none is selected for
                  you. Choose the one you are reproducing, or enter your own survey.
                </p>
                {PAPER_BASELINE_OPTIONS.map((option) => (
                  <label key={option.id} className="radio-field" htmlFor={`baseline-${option.id}`}>
                    <input
                      id={`baseline-${option.id}`}
                      type="radio"
                      name="baselineOption"
                      value={option.id}
                      checked={form.baselineOptionId === option.id}
                      onChange={() => setForm((current) => applyBaselineOption(current, option))}
                    />
                    <span>
                      <span className="radio-label">
                        {option.label} &mdash; {option.coverPercent}% in {option.year}
                      </span>
                      {option.conflict && <span className="conflict-tag">conflicts with the other tables</span>}
                      <span className="form-hint">{option.note}</span>
                    </span>
                  </label>
                ))}
                <label className="radio-field" htmlFor={`baseline-${OWN_SURVEY}`}>
                  <input
                    id={`baseline-${OWN_SURVEY}`}
                    type="radio"
                    name="baselineOption"
                    value={OWN_SURVEY}
                    checked={form.baselineOptionId === OWN_SURVEY}
                    onChange={() => setForm((current) => applyBaselineOption(current, null))}
                  />
                  <span>
                    <span className="radio-label">My own survey</span>
                    <span className="form-hint">Enter the cover, year, and citation yourself.</span>
                  </span>
                </label>
              </fieldset>}

              {selectedBaseline && (
                <p className="form-hint form-hint-spaced">
                  Cited as <strong>{selectedBaseline.source}</strong>. The cover, year, and source stay locked to that
                  citation so the number cannot drift from its source. Choose &ldquo;My own survey&rdquo; to change them.
                </p>
              )}

              <label htmlFor="coverPercent">
                Initial live coral cover (%)
                <input id="coverPercent" type="number" min="0" max="100" step="0.01" value={form.coverPercent}
                  readOnly={clientMode || selectedBaseline !== null} className={clientMode || selectedBaseline ? 'input-locked' : undefined}
                  onChange={(event) => update('coverPercent', event.target.value)} required />
              </label>

              <div className="settings-grid prediction-window-fields">
                <label htmlFor="predictionStartDate">Initial coral-cover year
                  <input id="predictionStartDate" type="date" value={`${form.baselineYear}-01-01`}
                    min="1900-01-01" max="2100-12-31" onChange={(event) => updateClientDate('startDate', event.target.value)} aria-describedby="prediction-window-note" />
                </label>
                <label htmlFor="predictionEndDate">Forecast ending year
                  <input id="predictionEndDate" type="date" value={`${form.forecastEndYear ?? Number(form.baselineYear) + Number(form.horizonYears)}-12-31`}
                    min={`${Number(form.baselineYear) + 1}-01-01`} max="2100-12-31"
                    onChange={(event) => updateClientDate('endDate', event.target.value)} aria-describedby="prediction-window-note" />
                </label>
                <p id="prediction-window-note" className="form-hint">Initial live coral cover is measured at the selected start year. Future years are mathematical model projections and do not require observed dataset rows.</p>
              </div>
              {false && <div className="prediction-window-summary" aria-live="polite">
                <strong>Forecast duration:</strong> {form.horizonYears} years ({form.baselineYear}–{form.forecastEndYear ?? Number(form.baselineYear) + Number(form.horizonYears)})
              </div>}
              {false && <p className="form-hint form-hint-spaced">
                The paper projects to 2036, which is 30 years from its 2006 baseline. Shorter horizons land inside the
                figures the paper reports for 2016.
              </p>}

              <label htmlFor="surveySource">
                Baseline source
                <input id="surveySource" type="text" maxLength={400} placeholder="Survey or report, citywide, with year"
                  readOnly={clientMode || selectedBaseline !== null} className={clientMode || selectedBaseline ? 'input-locked' : undefined}
                  value={form.surveySource} onChange={(event) => update('surveySource', event.target.value)} required />
              </label>
              <label htmlFor="surveyMethod">
                Baseline survey method
                <input id="surveyMethod" type="text" maxLength={300} placeholder="Describe how live cover was measured"
                  value={form.surveyMethod} onChange={(event) => update('surveyMethod', event.target.value)} />
              </label>
              {false && <p className="form-hint">
                Reef-site surveys are not interchangeable with the citywide scope. Confirm the scope matches before saving.
              </p>}

              {!clientMode && <label htmlFor="profile">
                Run mode
                <select id="profile" value={form.profile} onChange={(event) => {
                  const profile = event.target.value as FormState['profile'];
                  setForm((current) => profile === 'paper-reproduction'
                    ? { ...current, profile, baselineYear: '2006', coverPercent: '57', startDate: '2006-01-01', forecastEndYear: current.forecastEndYear || '2036', horizonYears: String(Number(current.forecastEndYear || '2036') - 2006), surveySource: current.surveySource || PAPER_REPRODUCTION_BASELINE_SOURCE('2006'), surveyMethod: current.surveyMethod || PAPER_REPRODUCTION_BASELINE_METHOD }
                    : { ...current, profile });
                }}>
                  <option value="paper">Paper profile</option>
                  <option value="scenario">Scenario</option>
                  <option value="paper-reproduction">Paper reproduction</option>
                  <option value="demo" disabled={!demoAllowed}>Demo</option>
                </select>
              </label>}

              {false && <div className="prediction-input-summary" aria-live="polite">
                <strong>Prediction summary</strong>
                <span>Profile: {form.profile === 'paper-reproduction' ? 'Paper reproduction' : form.profile}</span>
                <span>Initial year: {form.baselineYear}</span>
                <span>Initial live coral cover: {form.coverPercent || '—'}%</span>
                <span>Forecast ending year: {form.forecastEndYear ?? Number(form.baselineYear) + Number(form.horizonYears)}</span>
                <span>Forecast duration: {form.horizonYears} years</span>
              </div>}

              {false && form.profile === 'paper-reproduction' && (
                <Notice tone="warning" title="Paper-reproduction configuration">
                  <p><strong>Paper-reproduction baseline: 2006, 57% live coral cover.</strong></p>
                  <p>{PAPER_REPRODUCTION_LABEL}</p>
                  <p>C0: 57% in 2006 · alpha: 0.05 per °C per year · K: 70 provisional · beta: 5.6743e-8 provisional/inferred.</p>
                  <p>Tourism growth: {PAPER_REPRODUCTION_TOURISM_PERIODS.map((period) => `${period.startYear}-${period.endYear}: ${period.growthRate}`).join(' · ')} per year.</p>
                  <p>The paper also reports conflicting baseline values of 57.25% and 45.83%; they are retained as a warning and are not used by this profile.</p>
                </Notice>
              )}

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
                  {ASSUMABLE_KEYS.filter((candidate) => form.profile === 'scenario' || candidate.key === 'alpha').map((candidate) => {
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
                      : form.profile === 'paper-reproduction'
                        ? 'Run Paper Reproduction'
                      : 'Run prediction'}
              </button>
            </fieldset>
          </form>

          <section className="result-panel">
            <div className="panel-heading"><div><p className="eyebrow">Result</p><h2>Projection</h2></div></div>
            <div className="prediction-result-scroll">
            {blockedReason && !result && (
              <Notice tone="unavailable" title="The model refused this run">
                <p>{blockedReason}</p>
                {blockedKeys.length > 0 && form.profile !== 'scenario' && (
                  <>
                    <p>{blockedKeys.join(' and ')} {blockedKeys.length === 1 ? 'is' : 'are'} not specified in the published paper, so this run cannot be completed until a researcher supplies a cited value.</p>
                    <button type="button" className="text-button" onClick={switchToScenario}>Run this as a scenario</button>
                  </>
                )}
              </Notice>
            )}
            {error && !result && <Notice tone="danger" title="Prediction not completed">{error}<p className="form-hint">This attempt was saved to your prediction history.</p></Notice>}
            {locationNote && <Notice tone="info" title="Location">{locationNote}</Notice>}
            {!result && <p className="muted">Run the model to see the annual prediction table.</p>}
            {result?.status === 'unavailable' && <Notice tone="danger" title="Run not completed">{result.failureReason ?? 'The model did not produce an output.'}<p className="form-hint">This attempt is saved in history for traceability.</p></Notice>}
            {result && result.status !== 'unavailable' && (
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
                <div className="result-summary">
                  <div className="result-final-cover">
                    <span className="metric-label">Final annual average cover</span>
                    <strong className="prediction-number">{result.finalCoverPercent.toFixed(2)}%</strong>
                    <span className="muted">{(result.finalCoverPercent - result.initialCoverPercent).toFixed(2)} percentage points from baseline</span>
                  </div>
                  <dl className="result-meta">
                    <div><dt>Baseline</dt><dd>{result.initialCoverPercent.toFixed(2)}% · {result.baselineYear}</dd></div>
                    <div><dt>End year</dt><dd>{result.baselineYear + result.horizonYears}</dd></div>
                    <div><dt>Scope</dt><dd>Citywide annual average</dd></div>
                  </dl>
                </div>
                <div className="prediction-table-heading">
                  <div><p className="eyebrow">Annual output</p><h3>Prediction table</h3></div>
                  <span className="muted">End-of-year states and interval means</span>
                </div>
                <AnnualTable annual={result.annual} endpointsOnly />
                <div className="button-row">
                  <Link className="button button-small button-secondary" to={`/history?prediction=${result.predictionId}`}>Open in history</Link>
                  <a className="button button-small button-secondary" href={`/api/v1/predictions/${result.predictionId}/download?format=pdf`}>Download PDF</a>
                </div>
              </>
            )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
