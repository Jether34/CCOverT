import { AppShell, PageHeader } from '../components/AppShell';

export function GuidePage(): JSX.Element {
  return <AppShell><div className="page-container guide-page">
    <PageHeader eyebrow="Help" title="Guide and FAQ" description="A short guide to running and interpreting your CCOverT workspace." />
    <div className="guide-grid">
      <section className="panel"><p className="eyebrow">Getting started</p><h2>Run a prediction</h2><ol className="guide-steps"><li>Open Predict.</li><li>Review the researcher-configured date range and baseline cover.</li><li>Run the citywide annual-average projection.</li><li>Open History to inspect or download the saved result.</li></ol></section>
      <section className="panel"><p className="eyebrow">Reports</p><h2>Analyze evidence</h2><p>Select one of your saved predictions or drag in a supported report on the Reports page. Generated reports only use evidence you select and never change the deterministic prediction.</p></section>
      <section className="panel"><p className="eyebrow">FAQ</p><h2>What does the result mean?</h2><p>It is a citywide annual-average live coral-cover projection for Puerto Princesa City. It is not a reef-site forecast from a GPS point.</p><p>Demo, scenario, and paper-reproduction outputs are not independently validated findings.</p></section>
      <section className="panel"><p className="eyebrow">Data and privacy</p><h2>Who configures the system?</h2><p>Researchers manage model parameters and source datasets. Developers manage system operations and accounts. Clients run predictions and view their own history and reports.</p></section>
    </div>
  </div></AppShell>;
}
