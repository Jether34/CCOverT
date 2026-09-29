import { Link } from 'react-router-dom';
import { PAPER_ORGANIZATION, PAPER_SITES, TARGET_MEASURE } from '@ccovert/shared';
import { PublicHeader } from '../components/AppShell';

export function IndexPage(): JSX.Element {
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="landing-main" id="main">
        <section className="landing-hero" id="home">
          <div className="landing-hero-copy">
            <p className="eyebrow">Coral cover over time</p>
            <h1>Understand coral-cover change with confidence.</h1>
            <p className="hero-lede">CCOverT is a focused research workspace for exploring annual live coral-cover projections in Puerto Princesa City, Palawan. Clear inputs, readable results, and a simple path from data to insight.</p>
            <p className="muted landing-meta">Built for researchers, developers, and people who want a clear view of coral-cover information.</p>
          </div>
          <div className="landing-hero-visual" aria-label="Abstract coral reef illustration"><div className="reef-sun" /><div className="reef-water" /><div className="reef-coral coral-a" /><div className="reef-coral coral-b" /><div className="reef-coral coral-c" /><span className="visual-label">Puerto Princesa · Palawan</span></div>
        </section>

        <section className="landing-section" id="about"><div className="section-heading"><p className="eyebrow">About CCOverT</p><h2>A calm, practical home for coral-cover information.</h2><p className="lede">All findings and information on this system are based on the research paper of researchers from Palawan National School.</p></div><div className="landing-feature-grid"><article className="landing-feature"><span>01</span><h3>Explore clearly</h3><p>View projections, saved runs, and reports in a workspace designed to keep the important information easy to find.</p></article><article className="landing-feature"><span>02</span><h3>Work from evidence</h3><p>Keep model inputs, source information, and outputs connected so every result has useful context.</p></article><article className="landing-feature"><span>03</span><h3>Built for collaboration</h3><p>Give clients, researchers, and developers the tools that match their responsibilities across the system.</p></article></div></section>

        <section className="landing-section" id="researcher"><div className="section-heading"><p className="eyebrow">Researcher</p><h2>The people and work behind the study.</h2><p className="lede">The research team provides the study direction and subject-matter foundation for CCOverT.</p></div><div className="landing-org-chart" aria-label="Researcher organizational chart"><div className="org-lead"><strong>Palawan National School</strong><span>Research foundation</span></div><div className="org-connector" aria-hidden="true" /><div className="landing-org-grid">{PAPER_ORGANIZATION.map((person) => <article className="org-person" key={person.name}><div className="avatar">{person.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><strong>{person.name}</strong><span>{person.role}</span><small>{person.institution}</small></article>)}</div></div></section>

        <section className="landing-section" id="developer"><div className="section-heading"><p className="eyebrow">Developer</p><h2>One connected system, with clear ownership.</h2><p className="lede">Jether Garque leads the product engineering and system operations behind the CCOverT workspace.</p></div><div className="developer-profile"><div className="developer-avatar">JG</div><div><h3>Jether Garque</h3><p className="muted">Lead developer and system administrator</p></div><div className="developer-roles"><span>Product engineering</span><span>Platform operations</span><span>Data and access management</span><span>Experience design</span></div></div></section>

        <section className="landing-section" id="resources"><div className="section-heading"><p className="eyebrow">Resources</p><h2>Start with the resource that fits your role.</h2><p className="lede">Learn the workflow, explore the study context, or begin using the workspace.</p></div><div className="landing-resource-grid"><Link className="resource-card" to="/guide"><span className="data-label">Guide</span><h3>How to use CCOverT</h3><p>Follow the simple steps for running a projection and reading saved results.</p><span className="resource-arrow">Open guide →</span></Link><a className="resource-card" href="#about"><span className="data-label">About</span><h3>Study and application</h3><p>Learn what the system is designed to do and who it serves.</p><span className="resource-arrow">Read about CCOverT →</span></a><div className="resource-card"><span className="data-label">Study area</span><h3>Puerto Princesa City</h3><p>{TARGET_MEASURE} · {PAPER_SITES.length} reference locations in the study context.</p><span className="resource-arrow">Explore the workspace →</span></div></div></section>

        <section className="landing-cta"><div><p className="eyebrow">CCOverT workspace</p><h2>Explore coral-cover information with a clear, focused experience.</h2></div></section>
      </main>
      <footer className="public-footer">
        <div className="footer-brand"><Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">C%</span><span>CCOverT</span></Link><p>A Coral Cover Over Time Model for Puerto Princesa City, Palawan.</p></div>
        <div className="footer-column"><strong>Research project</strong><span>Mathematics and Computational Science</span><span>Palawan National School</span><span>Puerto Princesa, Palawan</span></div>
        <div className="footer-column"><strong>Project team</strong><span>Jhenica O. Gabuat · Researcher</span><span>Nonie Mae C. Montojo · Adviser</span><span>Jessa Mae P. Abrina · Consultant</span></div>
        <div className="footer-column footer-links"><strong>Explore</strong><a href="#about">About</a><a href="#researcher">Researcher</a><a href="#resources">Resources</a></div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} CCOverT</span><span>Research information and application workspace</span></div>
      </footer>
    </div>
  );
}
