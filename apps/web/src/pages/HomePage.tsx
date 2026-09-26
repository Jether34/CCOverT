import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardResponse } from '@ccovert/shared';
import { dashboardApi, getErrorMessage } from '../lib/api';
import { AppShell, PageHeader } from '../components/AppShell';
import { EmptyState, ErrorState, LoadingState, Notice } from '../components/States';
import { PredictionSummaryCard, ReferenceChart, WarningList } from '../components/ReferenceChart';
import { PAPER_REPORTED_AVERAGE_COVER, PAPER_REPORTED_PROJECTED_COVER } from '@ccovert/shared';

export function HomePage(): JSX.Element {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    dashboardApi.load()
      .then(setDashboard)
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)));
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          eyebrow="Workspace"
          title="Dashboard"
          description="A balanced view of your saved runs and the Puerto Princesa City study scope."
        />

        {error && <Notice tone="danger" title="Could not load your dashboard">{error}</Notice>}
        {!dashboard && !error && <LoadingState label="Loading your workspace" />}

        {dashboard && (
          <>
            <div className="dashboard-quadrant">
              <section className="panel dashboard-quadrant-card dashboard-overview">
                <div className="panel-heading">
                  <div><p className="eyebrow">Snapshot</p><h2>Workspace overview</h2></div>
                </div>
                <div className="dashboard-metrics">
                  <div className="stat-card"><span className="metric-label">Saved predictions</span><span className="metric-large">{dashboard.predictionCount}</span></div>
                  <div className="stat-card"><span className="metric-label">AI reports</span><span className="metric-large">{dashboard.aiReportCount}</span></div>
                  <div className="stat-card"><span className="metric-label">Available datasets</span><span className="metric-large">{dashboard.datasetCount}</span></div>
                  <div className="stat-card"><span className="metric-label">Study area</span><span className="metric-large">{dashboard.studyArea.label.split(',')[0]}</span></div>
                </div>
              </section>

              <section className="panel dashboard-quadrant-card dashboard-latest">
                <div className="panel-heading">
                  <div><p className="eyebrow">Latest</p><h2>Most recent prediction</h2></div>
                  <Link className="button button-small button-secondary" to="/history">All history</Link>
                </div>
                {dashboard.latestPrediction ? (
                  <>
                    <PredictionSummaryCard prediction={dashboard.latestPrediction} onOpen={(id) => { window.location.href = `/history?prediction=${id}`; }} />
                    <WarningList warnings={dashboard.latestPrediction.warnings} />
                  </>
                ) : (
                  <EmptyState title="No saved predictions yet">
                    <p>Once the researcher has configured the model, run your first citywide projection.</p>
                    <Link className="button button-primary" to="/predict">Open the prediction form</Link>
                  </EmptyState>
                )}
              </section>

              <aside className="panel dashboard-quadrant-card dashboard-scope">
                <div className="panel-heading"><div><p className="eyebrow">Location</p><h2>Scope</h2></div></div>
                <p>{dashboard.locationStatus.message}</p>
                <dl className="detail-list">
                  <div><dt>Study area</dt><dd>{dashboard.studyArea.label}</dd></div>
                  <div><dt>Scope</dt><dd>{dashboard.studyArea.scope}</dd></div>
                  <div><dt>Site-level forecast</dt><dd>Not available</dd></div>
                  <div><dt>Consented location stored</dt><dd>{dashboard.locationStatus.consentedLocation ? 'Yes, context only' : 'No'}</dd></div>
                </dl>
              </aside>

              <section className="panel dashboard-quadrant-card dashboard-history">
                <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Recent runs</h2></div></div>
                {dashboard.historySnapshot.length > 0
                  ? <div className="record-list">
                      {dashboard.historySnapshot.slice(0, 3).map((prediction) => (
                        <PredictionSummaryCard key={prediction.predictionId} prediction={prediction} onOpen={(id) => { window.location.href = `/history?prediction=${id}`; }} />
                      ))}
                    </div>
                  : <EmptyState title="No saved predictions yet"><Link className="button button-primary" to="/predict">Run a prediction</Link></EmptyState>}
              </section>
            </div>

            <div className="two-chart-grid">
              <ReferenceChart points={PAPER_REPORTED_AVERAGE_COVER} title="Paper-reported average cover" description="Reference only, never a model input." />
              <ReferenceChart points={PAPER_REPORTED_PROJECTED_COVER} title="Paper-reported projection" description="Reproduced as printed, conflicts included." />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
