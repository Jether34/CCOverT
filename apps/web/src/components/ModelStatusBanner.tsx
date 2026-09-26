import { Link } from 'react-router-dom';
import { useModelStatus } from '../context/AuthContext';
import { ConditionBadge } from './ReferenceChart';
import { useAuth } from '../context/AuthContext';

/**
 * A permanent, non-dismissible statement of whether the model can run, why it
 * cannot, and what a researcher has to do about it.
 */
export function ModelStatusBanner(): JSX.Element | null {
  const { status, loading } = useModelStatus();
  const { user } = useAuth();
  if (loading || !status) return null;

  if (!status.configured) {
    const keys = status.missingParameters.map((parameter) => parameter.key);
    return (
      <div className="notice notice-unavailable" role="status">
        <div>
          <strong>Paper profile not configured</strong>
          <div className="notice-body">
            <p>
              Paper-profile runs stay blocked while research parameters are missing.{' '}
              {keys.length === 1 ? 'The parameter' : 'The parameters'} <strong>{keys.join(', ')}</strong>{' '}
              {keys.length === 1 ? 'has' : 'have'} no value. The paper does not publish {keys.length === 1 ? 'it' : 'them'}, and this
              application never substitutes zero or any other placeholder.
            </p>
            <p>
              A clearly labelled DEMO profile may be available for development, and verified users can run an exploratory
              scenario with explicit assumptions. Neither is a validated finding.
            </p>
          </div>
        </div>
        {user?.role === 'researcher' && <div className="notice-action">
          <Link className="button button-small button-secondary" to="/model">Model status</Link>
          <Link className="button button-small button-primary" to="/data">Import data</Link>
        </div>}
      </div>
    );
  }

  if (status.service === 'unavailable') {
    return (
      <div className="notice notice-warning" role="status">
        <div>
          <strong>The model is configured but the internal model service is unreachable</strong>
          <div className="notice-body"><p>Predictions are refused until the service responds. Nothing is saved when it fails.</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="notice notice-success" role="status">
      <div>
        <strong>Model configured and ready</strong>
        <div className="notice-body">
          <p>
            Configuration {status.activeModelConfigVersion ?? 'unknown'} with {status.activeProfile ?? 'paper'} parameters.{' '}
            {status.provisionalParameters.length > 0 && `Provisional values: ${status.provisionalParameters.join(', ')}.`}
          </p>
        </div>
      </div>
      <div className="notice-action">
        {status.activeProfile === 'demo' && <ConditionBadge label="DEMO profile active" status="danger" />}
        <Link className="button button-small button-secondary" to="/model">Model status</Link>
      </div>
    </div>
  );
}
