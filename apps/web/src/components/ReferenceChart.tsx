import type { AnnualPredictionPoint, ModelParameter, PaperCoverPoint, PredictionRecord, SourceRecord } from '@ccovert/shared';
import { classifyPercent, SCENARIO_LABEL } from '@ccovert/shared';

export function ConditionBadge({ label, status = 'good' }: { label: string; status?: 'neutral' | 'good' | 'warning' | 'warn' | 'danger' | 'unavailable' }): JSX.Element {
  // `warn` is an accepted alias for the warning tone.
  const tone = status === 'neutral' ? 'good' : status === 'warn' ? 'warning' : status;
  return <span className={`condition-badge condition-${tone}`}>{label}</span>;
}

const conditionTone = (value: number | null, bands: PredictionRecord['classificationConvention']['bands']): 'good' | 'warning' | 'danger' | 'unavailable' => {
  if (value === null) return 'unavailable';
  const label = classifyPercent(value, bands);
  if (label === 'Excellent' || label === 'Good') return 'good';
  if (label === 'Fair') return 'warning';
  if (label === 'Poor') return 'danger';
  return 'good';
};

export function PredictionSummaryCard({ prediction, onOpen }: { prediction: PredictionRecord; onOpen?: (id: string) => void }): JSX.Element {
  const endYear = prediction.baselineYear + prediction.horizonYears;
  const bands = prediction.classificationConvention.bands;
  return (
    <article className="prediction-card">
      <div className="card-kicker">
        <span>{prediction.targetMeasure}</span>
        {prediction.isDemo
          ? <ConditionBadge label="DEMO" status="danger" />
          : prediction.isScenario
            ? <ConditionBadge label={SCENARIO_LABEL} status="danger" />
            : prediction.isPaperReproduction
              ? <ConditionBadge label="PAPER-REPRODUCTION" status="warning" />
            : prediction.status === 'unavailable'
              ? <ConditionBadge label="Not completed" status="unavailable" />
            : <ConditionBadge label="Model projection" status="good" />}
      </div>
      <div className="prediction-number">{prediction.status === 'unavailable' ? '—' : `${prediction.finalCoverPercent.toFixed(2)}%`}</div>
      <p className="muted">{prediction.baselineYear} ({prediction.initialCoverPercent.toFixed(2)}%) to {endYear}</p>
      <div className="card-meta">
        <span>Config {prediction.modelConfigVersion}</span>
        <span>{new Date(prediction.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="button-row">
        <ConditionBadge
          label={prediction.stateClassification ?? 'unclassified'}
          status={conditionTone(prediction.finalCoverPercent, bands)}
        />
        {onOpen && <button className="button button-small button-secondary" type="button" onClick={() => onOpen(prediction.predictionId)}>Details</button>}
      </div>
    </article>
  );
}

export function ReferenceChart({ points, title = 'Paper-reported live coral cover', description, showAccessibleTable = true }: { points: PaperCoverPoint[]; title?: string; description?: string; showAccessibleTable?: boolean }): JSX.Element {
  const width = 720;
  const height = 260;
  const padding = 28;
  const max = 100;
  if (points.length === 0) return <div className="state-panel empty-state"><p>No chart data is available.</p></div>;
  const x = (year: number) => padding + ((year - points[0].year) / Math.max(1, points[points.length - 1].year - points[0].year)) * (width - padding * 2);
  const y = (percent: number) => height - padding - (percent / max) * (height - padding * 2);
  const polyline = points.map((point) => `${x(point.year)},${y(point.percent)}`).join(' ');
  return (
    <figure className="chart-card">
      <figcaption><strong>{title}</strong>{description && <span>{description}</span>}</figcaption>
      <div className="chart-scroll">
        <svg
          className="line-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}. ${points.some((point) => point.status === 'model-output') ? 'Includes a newly computed model output.' : 'All values are reported by the research attachment.'}`}
        >
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-axis" />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="chart-axis" />
          <polyline points={polyline} className="chart-line" />
          {points.map((point) => (
            <circle key={`${point.year}-${point.status}`} cx={x(point.year)} cy={y(point.percent)} r="4" className="chart-dot">
              <title>{point.year}: {point.percent}% {point.status}</title>
            </circle>
          ))}
          <text x={padding} y={height - 7} className="chart-label">{points[0]?.year}</text>
          <text x={width - padding} y={height - 7} textAnchor="end" className="chart-label">{points[points.length - 1]?.year}</text>
          <text x={4} y={padding + 4} className="chart-label">100%</text>
          <text x={12} y={height - padding} className="chart-label">0%</text>
        </svg>
      </div>
      {showAccessibleTable && <details className="table-alternative">
        <summary>Accessible table alternative</summary>
        <table>
          <caption>{title} (%)</caption>
          <thead><tr><th scope="col">Year</th><th scope="col">Percent</th><th scope="col">Status</th></tr></thead>
          <tbody>{points.map((point) => <tr key={`${point.year}-${point.status}`}><td>{point.year}</td><td>{point.percent}%</td><td>{point.status}</td></tr>)}</tbody>
        </table>
      </details>}
    </figure>
  );
}

/** The model's own annual output, plotted with the observed baseline point. */
export function AnnualSeriesChart({ prediction }: { prediction: PredictionRecord }): JSX.Element {
  const points: PaperCoverPoint[] = [
    { year: prediction.baselineYear, percent: prediction.initialCoverPercent, status: 'paper-reported' },
    ...prediction.annual.map((point) => ({ year: point.year, percent: point.coverEndPercent, status: 'model-output' as const }))
  ];
  return <ReferenceChart
    points={points}
    title={`Model projection: ${prediction.initialCoverPercent.toFixed(2)}% in ${prediction.baselineYear}`}
    description={`End-of-year states from the RK4 solver, ${prediction.solver.substepsPerYear} substeps per year.`}
    showAccessibleTable={false}
  />;
}

export function AnnualTable({ annual, endpointsOnly = false }: { annual: AnnualPredictionPoint[]; endpointsOnly?: boolean }): JSX.Element {
  const rows = endpointsOnly && annual.length > 2 ? [annual[0], annual[annual.length - 1]] : annual;
  return (
    <div className="table-wrap annual-output-table">
      <table>
        <caption className="sr-only">Annual model output</caption>
        <thead>
          <tr>
            <th scope="col">Year</th><th scope="col">Cover start %</th><th scope="col">Cover end %</th>
            <th scope="col">Interval mean %</th><th scope="col">Mean SST &deg;C</th><th scope="col">Arrivals</th>
            <th scope="col">Growth pp</th><th scope="col">Thermal pp</th><th scope="col">Tourism pp</th>
            <th scope="col">Tourism g</th><th scope="col">Growth period</th>
            <th scope="col">Condition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr key={point.year}>
              <th scope="row">{point.year}</th>
              <td data-label="Cover start %">{point.coverStartPercent.toFixed(3)}</td>
              <td data-label="Cover end %">{point.coverEndPercent.toFixed(3)}</td>
              <td data-label="Interval mean %">{point.coverIntervalMeanPercent.toFixed(3)}</td>
              <td data-label="Mean SST °C">{((point.temperatureStartC + point.temperatureEndC) / 2).toFixed(3)}</td>
              <td data-label="Arrivals">{Math.round((point.tourismStartArrivals + point.tourismEndArrivals) / 2).toLocaleString()}</td>
              <td data-label="Growth pp">{point.growthContributionPp.toFixed(3)}</td>
              <td data-label="Thermal pp">{point.thermalContributionPp.toFixed(3)}</td>
              <td data-label="Tourism pp">{point.tourismContributionPp.toFixed(3)}</td>
              <td data-label="Tourism g">{(point.tourismGrowthRate ?? 0).toFixed(6)}</td>
              <td data-label="Growth period">{point.tourismPeriodStartYear && point.tourismPeriodEndYear ? `${point.tourismPeriodStartYear}-${point.tourismPeriodEndYear}` : 'continuous model'}</td>
              <td data-label="Condition">{point.meanClassification ?? 'unclassified'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A reproducibility-oriented view of every stored annual solver output. */
export function ComputationBreakdownTable({ annual }: { annual: AnnualPredictionPoint[] }): JSX.Element {
  return (
    <div className="table-wrap computation-breakdown-table">
      <table>
        <caption className="sr-only">Mathematical computation breakdown by forecast year</caption>
        <thead>
          <tr>
            <th scope="col">Year</th><th scope="col">t</th><th scope="col">C start</th><th scope="col">C end</th><th scope="col">C mean</th>
            <th scope="col">T start</th><th scope="col">T end</th><th scope="col">V start</th><th scope="col">V end</th><th scope="col">g</th>
            <th scope="col">Growth rate</th><th scope="col">Thermal rate</th><th scope="col">Tourism rate</th>
            <th scope="col">Growth pp</th><th scope="col">Thermal pp</th><th scope="col">Tourism pp</th>
          </tr>
        </thead>
        <tbody>
          {annual.map((point) => (
            <tr key={point.year}>
              <th scope="row">{point.year}</th>
              <td data-label="t">{point.tYears.toFixed(3)}</td>
              <td data-label="C start">{point.coverStartPercent.toFixed(3)}</td>
              <td data-label="C end">{point.coverEndPercent.toFixed(3)}</td>
              <td data-label="C mean">{point.coverIntervalMeanPercent.toFixed(3)}</td>
              <td data-label="T start">{point.temperatureStartC.toFixed(3)}</td>
              <td data-label="T end">{point.temperatureEndC.toFixed(3)}</td>
              <td data-label="V start">{Math.round(point.tourismStartArrivals).toLocaleString()}</td>
              <td data-label="V end">{Math.round(point.tourismEndArrivals).toLocaleString()}</td>
              <td data-label="g">{(point.tourismGrowthRate ?? 0).toFixed(6)}</td>
              <td data-label="Growth rate">{point.growthRateMean.toFixed(6)}</td>
              <td data-label="Thermal rate">{point.thermalRateMean.toFixed(6)}</td>
              <td data-label="Tourism rate">{point.tourismRateMean.toFixed(6)}</td>
              <td data-label="Growth pp">{point.growthContributionPp.toFixed(3)}</td>
              <td data-label="Thermal pp">{point.thermalContributionPp.toFixed(3)}</td>
              <td data-label="Tourism pp">{point.tourismContributionPp.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const parameterValue = (parameters: ModelParameter[], key: string): number | null =>
  parameters.find((parameter) => parameter.key === key)?.value ?? null;

const computationNumber = (value: number | null, digits = 6): string =>
  value === null || !Number.isFinite(value) ? 'not configured' : value.toFixed(digits);

/** Shows the actual equation substitution alongside the stored solver output. */
export function MathematicalBreakdown({ prediction }: { prediction: PredictionRecord }): JSX.Element {
  const r = parameterValue(prediction.parameters, 'r');
  const alpha = parameterValue(prediction.parameters, 'alpha');
  const beta = parameterValue(prediction.parameters, 'beta');
  const k = parameterValue(prediction.parameters, 'K');
  const t0 = parameterValue(prediction.parameters, 'T0');
  const gamma = parameterValue(prediction.parameters, 'gamma');
  const tcrit = parameterValue(prediction.parameters, 'Tcrit');
  return (
    <div className="math-breakdown">
      <div className="equation-card">
        <strong>Equation evaluated by the RK4 solver</strong>
        <code>dC/dt = r·C·(1 − C/K) − α·max(0, T(t) − Tcrit)·C − β·V(t)·C</code>
        <code>T(t) = T0 + γ·t</code>
        <code>V(t) = continuous piecewise tourism projection from V0 at {prediction.baselineYear}</code>
        <span className="muted">t = 0 at {prediction.baselineYear}; each stored contribution is the solver’s interval-mean percentage-point contribution.</span>
      </div>
      <div className="equation-card">
        <strong>Resolved parameter values</strong>
        <div className="equation-values">
          <span>r = {computationNumber(r)} / year</span>
          <span>K = {computationNumber(k, 3)} percentage points</span>
          <span>α = {computationNumber(alpha)} per °C per year</span>
          <span>β = {computationNumber(beta)}</span>
          <span>T0 = {computationNumber(t0, 3)} °C</span>
          <span>γ = {computationNumber(gamma, 3)} °C / year</span>
          <span>Tcrit = {computationNumber(tcrit, 3)} °C</span>
        </div>
      </div>
      <div className="calculation-list">
        {prediction.annual.map((point) => {
          const cover = point.coverStartPercent;
          const temperature = point.temperatureStartC;
          const arrivals = point.tourismStartArrivals;
          const growth = r !== null && k !== null ? r * cover * (1 - cover / k) : null;
          const thermal = alpha !== null && tcrit !== null ? alpha * Math.max(0, temperature - tcrit) * cover : null;
          const tourism = beta !== null ? beta * arrivals * cover : null;
          const derivative = growth !== null && thermal !== null && tourism !== null ? growth - thermal - tourism : null;
          return (
            <details className="calculation-item" key={point.year}>
              <summary><strong>{point.year}</strong><span className="muted">t={point.tYears.toFixed(2)} · C end={point.coverEndPercent.toFixed(3)}%</span></summary>
              <div className="calculation-detail">
                <code>t = {point.tYears.toFixed(3)}; C = {cover.toFixed(3)}; T = {temperature.toFixed(3)}; V = {Math.round(arrivals).toLocaleString()}</code>
                <code>growth = {computationNumber(r)} × {cover.toFixed(3)} × (1 − {cover.toFixed(3)} / {computationNumber(k, 3)}) = {computationNumber(growth)}</code>
                <code>thermal = {computationNumber(alpha)} × max(0, {temperature.toFixed(3)} − {computationNumber(tcrit, 3)}) × {cover.toFixed(3)} = {computationNumber(thermal)}</code>
                <code>tourism = {computationNumber(beta)} × {Math.round(arrivals).toLocaleString()} × {cover.toFixed(3)} = {computationNumber(tourism)}</code>
                <code>dC/dt = {computationNumber(growth)} − {computationNumber(thermal)} − {computationNumber(tourism)} = {computationNumber(derivative)} percentage points/year</code>
                <span className="muted">Stored interval means: growth {point.growthContributionPp.toFixed(3)} pp, thermal {point.thermalContributionPp.toFixed(3)} pp, tourism {point.tourismContributionPp.toFixed(3)} pp.</span>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function ParameterTable({ parameters }: { parameters: ModelParameter[] }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Model parameters, values, and provenance</caption>
        <thead>
          <tr><th scope="col">Key</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Status</th><th scope="col">Provenance</th></tr>
        </thead>
        <tbody>
          {parameters.map((parameter) => (
            <tr key={parameter.key}>
              <th scope="row">{parameter.symbol} <span className="muted">({parameter.key})</span></th>
              <td>{parameter.value === null ? <ConditionBadge label="not configured" status="unavailable" /> : parameter.value}</td>
              <td>{parameter.unit}</td>
              <td>{parameter.status}</td>
              <td>{parameter.provenance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceTable({ sources }: { sources: SourceRecord[] }): JSX.Element {
  if (sources.length === 0) return <p className="muted">No sources were recorded for this run.</p>;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Sourced inputs</caption>
        <thead>
          <tr><th scope="col">Series</th><th scope="col">Source</th><th scope="col">Unit</th><th scope="col">Window</th><th scope="col">Coverage</th></tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={`${source.name}-${source.timeWindow}`}>
              <th scope="row">{source.name}</th>
              <td>{source.source}</td>
              <td>{source.unit}</td>
              <td>{source.timeWindow}</td>
              <td>{source.coverage ?? 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WarningList({ warnings, title = 'Warnings and conflicts' }: { warnings: string[]; title?: string }): JSX.Element | null {
  if (warnings.length === 0) return null;
  return (
    <div className="notice notice-warning" role="status">
      <div>
        <strong>{title}</strong>
        <div className="notice-body">
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
