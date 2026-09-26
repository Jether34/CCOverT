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
            : <ConditionBadge label="Model projection" status="good" />}
      </div>
      <div className="prediction-number">{prediction.finalCoverPercent.toFixed(2)}%</div>
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

export function ReferenceChart({ points, title = 'Paper-reported live coral cover', description }: { points: PaperCoverPoint[]; title?: string; description?: string }): JSX.Element {
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
      <details className="table-alternative">
        <summary>Accessible table alternative</summary>
        <table>
          <caption>{title} (%)</caption>
          <thead><tr><th scope="col">Year</th><th scope="col">Percent</th><th scope="col">Status</th></tr></thead>
          <tbody>{points.map((point) => <tr key={`${point.year}-${point.status}`}><td>{point.year}</td><td>{point.percent}%</td><td>{point.status}</td></tr>)}</tbody>
        </table>
      </details>
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
  />;
}

export function AnnualTable({ annual }: { annual: AnnualPredictionPoint[] }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Annual model output</caption>
        <thead>
          <tr>
            <th scope="col">Year</th><th scope="col">Cover start %</th><th scope="col">Cover end %</th>
            <th scope="col">Interval mean %</th><th scope="col">Mean SST &deg;C</th><th scope="col">Arrivals</th>
            <th scope="col">Growth pp</th><th scope="col">Thermal pp</th><th scope="col">Tourism pp</th>
            <th scope="col">Condition</th>
          </tr>
        </thead>
        <tbody>
          {annual.map((point) => (
            <tr key={point.year}>
              <th scope="row">{point.year}</th>
              <td>{point.coverStartPercent.toFixed(3)}</td>
              <td>{point.coverEndPercent.toFixed(3)}</td>
              <td>{point.coverIntervalMeanPercent.toFixed(3)}</td>
              <td>{((point.temperatureStartC + point.temperatureEndC) / 2).toFixed(3)}</td>
              <td>{Math.round((point.tourismStartArrivals + point.tourismEndArrivals) / 2).toLocaleString()}</td>
              <td>{point.growthContributionPp.toFixed(3)}</td>
              <td>{point.thermalContributionPp.toFixed(3)}</td>
              <td>{point.tourismContributionPp.toFixed(3)}</td>
              <td>{point.meanClassification ?? 'unclassified'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
