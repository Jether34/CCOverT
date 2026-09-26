import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CONDITION_CONVENTION,
  DEMO_PROFILE_LABEL,
  PAPER_CONFLICTS,
  PAPER_ORGANIZATION,
  PAPER_PARAMETERS,
  PAPER_REPORTED_ACCURACY,
  PAPER_REPORTED_AVERAGE_COVER,
  PAPER_REPORTED_MAE,
  PAPER_REPORTED_PROJECTED_COVER,
  PAPER_SITES,
  REQUIRED_PARAMETER_KEYS,
  SOLVER_DEFAULTS,
  TARGET_MEASURE
} from '@ccovert/shared';
import { researchApi } from '../lib/api';
import type { ResearchSummary } from '@ccovert/shared';
import { PublicHeader } from '../components/AppShell';
import { Notice } from '../components/States';
import { ConditionBadge, ParameterTable, ReferenceChart } from '../components/ReferenceChart';

export function IndexPage(): JSX.Element {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    researchApi.summary().then(setSummary).catch(() => setError('The research summary could not be loaded.'));
  }, []);

  return (
    <div className="public-page">
      <PublicHeader />
      <main className="page-container" id="main">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Coral cover over time</p>
            <h1>CCOverT for Puerto Princesa City, Palawan</h1>
            <p className="hero-lede">
              A citywide annual model of live coral cover, implemented exactly as published:
              {' '}<code>dC/dt = r&middot;C&middot;(1 &minus; C/K) &minus; &alpha;&middot;max(0, T(t) &minus; Tcrit)&middot;C &minus; &beta;&middot;V(t)&middot;C</code>
              {' '}with <code>T(t) = T0 + &gamma;&middot;t</code> and <code>V(t) = V0&middot;exp(g&middot;t)</code>, integrated with RK4.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" to="/signup">Create an account</Link>
              <Link className="button button-secondary" to="/login">Log in</Link>
            </div>
            <p className="muted">Target measure: {TARGET_MEASURE}. This is a projection, never an observation.</p>
          </div>
        </section>

        {error && <Notice tone="danger" title="Could not load the research summary">{error}</Notice>}

        <section className="content-section" id="research">
          <p className="section-intro">
            The paper reports that <strong>alpha</strong> (thermal mortality) and <strong>g</strong> (tourism growth) are not
            specified. This application refuses to run the model until a researcher configures them from a cited source.
          </p>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <h3>Published values only</h3>
              <p>Every parameter carries its provenance, status, and review state. Provisional values stay flagged; missing values stay empty.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <h3>Sourced inputs</h3>
              <p>Sea-surface temperature and tourist arrivals must come from an imported series with a citation, or the run is labelled unsourced.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <h3>Visible limits</h3>
              <p>Paper conflicts, the rejected MAE, and the condition-band convention are shown with every result instead of being smoothed over.</p>
            </article>
          </div>
        </section>

        <section className="two-chart-grid">
          <ReferenceChart
            points={PAPER_REPORTED_AVERAGE_COVER}
            title="Paper-reported average live coral cover"
            description="Reported by the research attachment. Not used as a model input."
          />
          <ReferenceChart
            points={PAPER_REPORTED_PROJECTED_COVER}
            title="Paper-reported projected cover"
            description="As printed in the attachment, with its conflicting validation tables left intact."
          />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Model</p><h2>Parameters and status</h2></div>
            <Link className="button button-small button-secondary" to="/model">Full model page</Link>
          </div>
          <ParameterTable parameters={PAPER_PARAMETERS} />
          <dl className="detail-list">
            <div><dt>Missing values</dt><dd>{PAPER_PARAMETERS.filter((parameter) => parameter.value === null).map((parameter) => parameter.key).join(', ') || 'none'}</dd></div>
            <div><dt>Provisional values</dt><dd>{PAPER_PARAMETERS.filter((parameter) => parameter.status === 'provisional').map((parameter) => parameter.key).join(', ') || 'none'}</dd></div>
            <div><dt>Solver</dt><dd>{SOLVER_DEFAULTS.method.toUpperCase()}, {SOLVER_DEFAULTS.substepsPerYear} substeps per year, {SOLVER_DEFAULTS.intervalMeanQuadrature} interval means</dd></div>
            <div><dt>Condition bands</dt><dd>{CONDITION_CONVENTION.label}</dd></div>
            <div><dt>Demo profile</dt><dd>{DEMO_PROFILE_LABEL}</dd></div>
            <div><dt>Paper-reported MAE</dt><dd>{PAPER_REPORTED_MAE} (not reproducible from the published inputs)</dd></div>
            <div><dt>Reported accuracy</dt><dd>{PAPER_REPORTED_ACCURACY.table4.length} rows in Table 4 and {PAPER_REPORTED_ACCURACY.table5.length} rows in Table 5, which disagree with each other</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Conflicts on record</p><h2>What the paper leaves unresolved</h2></div>
          </div>
          <div className="record-list">
            {PAPER_CONFLICTS.map((conflict) => (
              <article className="record-grid" key={conflict.id}>
                <div><ConditionBadge label={conflict.severity} status={conflict.severity === 'warning' ? 'warning' : 'neutral'} /></div>
                <div><h3>{conflict.title}</h3><p>{conflict.detail}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Study</p><h2>Authors and sites</h2></div>
          </div>
          <div className="org-card">
            {PAPER_ORGANIZATION.map((person) => (
              <div key={person.name}><strong>{person.name}</strong><span className="muted">{person.role} &middot; {person.institution}</span></div>
            ))}
          </div>
          <p className="muted">Sites named in the attachment ({PAPER_SITES.length}). These are reference context only: the model is citywide, and reef-site observations are not interchangeable with that scope.</p>
          <ul className="reference-list">
            {PAPER_SITES.map((site) => <li key={site}>{site}</li>)}
          </ul>
        </section>

        <section className="cta-section">
          <h2>Run the model with your own sourced inputs</h2>
          <p>Create an account to import datasets, save predictions, download results, and generate cited reports.</p>
          <Link className="button button-primary" to="/signup">Create an account</Link>
        </section>
      </main>
      <footer className="public-footer">
        <span>CCOverT research workspace</span>
        <span>Required parameters: {REQUIRED_PARAMETER_KEYS.join(', ')}</span>
      </footer>
    </div>
  );
}
