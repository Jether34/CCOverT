import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardResponse } from '@ccovert/shared';
import { dashboardApi, getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { EmptyState, ErrorState, LoadingState, Notice } from '../components/States';
import { PredictionSummaryCard, ReferenceChart } from '../components/ReferenceChart';
import { PAPER_REPORTED_AVERAGE_COVER, PAPER_REPORTED_PROJECTED_COVER } from '@ccovert/shared';

export function HomePage(): JSX.Element {
  const { user } = useAuth();
  const clientMode = user?.role === 'client' || user?.role === 'user';
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
              <div className="dashboard-metrics dashboard-overview-metrics">
                <div className="stat-card"><span className="metric-label">Saved predictions</span><span className="metric-large">{dashboard.predictionCount}</span></div>
                <div className="stat-card"><span className="metric-label">AI reports</span><span className="metric-large">{dashboard.aiReportCount}</span></div>
                <div className="stat-card"><span className="metric-label">Available datasets</span><span className="metric-large">{dashboard.datasetCount}</span></div>
                <div className="stat-card"><span className="metric-label">Study area</span><span className="metric-large">{dashboard.studyArea.label.split(',')[0]}</span></div>
              </div>

              <section className="panel dashboard-quadrant-card dashboard-latest">
                <div className="panel-heading">
                  <div><p className="eyebrow">Latest</p><h2>Most recent prediction</h2></div>
                  <Link className="button button-small button-secondary" to="/history">All history</Link>
                </div>
                {dashboard.latestPrediction ? (
                  <>
                    <PredictionSummaryCard prediction={dashboard.latestPrediction} onOpen={(id) => { window.location.href = `/history?prediction=${id}`; }} />
                  </>
                ) : (
                  <EmptyState title="No saved predictions yet">
                    <p>Once the researcher has configured the model, run your first citywide projection.</p>
                    <Link className="button button-primary" to="/predict">Open the prediction form</Link>
                  </EmptyState>
                )}
              </section>

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

            {!clientMode && <div className="two-chart-grid">
              <ReferenceChart points={PAPER_REPORTED_AVERAGE_COVER} title="Paper-reported average cover" description="Reference only, never a model input." />
              <ReferenceChart points={PAPER_REPORTED_PROJECTED_COVER} title="Paper-reported projection" description="Reproduced as printed, conflicts included." />
            </div>}
          </>
        )}
      </div>
    </AppShell>
  );
}
