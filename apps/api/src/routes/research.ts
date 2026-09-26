import { Router } from 'express';
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
  SOLVER_DEFAULTS,
  STUDY_AREA,
  TARGET_MEASURE,
  type ResearchSummary
} from '@ccovert/shared';

const EQUATIONS = {
  coralCover: 'dC/dt = r*C*(1 - C/K) - alpha*max(0, T(t) - Tcrit)*C - beta*V(t)*C',
  temperature: 'T(t) = T0 + gamma*t',
  tourism: 'V(t) = V0*exp(g*t)'
} as const;

/**
 * The research summary is reference information only. Every value here comes
 * from the paper attachment as recorded in @ccovert/shared, and nothing in this
 * payload is a model input or a computed result.
 */
const buildSummary = (): ResearchSummary => ({
  title: 'CCOverT: A Coral Cover Over Time Model for Predicting Coral Reef Changes in Puerto Princesa City, Palawan',
  organization: PAPER_ORGANIZATION,
  sites: PAPER_SITES,
  targetMeasure: TARGET_MEASURE,
  equations: EQUATIONS,
  reportedAverageCover: [...PAPER_REPORTED_AVERAGE_COVER],
  reportedProjectedCover: [...PAPER_REPORTED_PROJECTED_COVER],
  reportedAccuracy: PAPER_REPORTED_ACCURACY,
  accuracyDisclaimer:
    `The paper reports an MAE of ${PAPER_REPORTED_MAE} in Table 4, but Table 4 and Table 5 ` +
    'disagree about the 2006 observed cover, and neither table can be reproduced from the ' +
    'published inputs. The reported accuracy is shown as printed and is not used as evidence that this implementation is correct.',
  conditionConvention: CONDITION_CONVENTION,
  paperConflicts: PAPER_CONFLICTS,
  referenceDiagnostics: [
    {
      label: 'Parameters not specified in the paper',
      value: PAPER_PARAMETERS.filter((parameter) => parameter.value === null).map((parameter) => parameter.key).join(', ') || 'none',
      note: 'The model refuses to run until a researcher configures these from a cited source.'
    },
    {
      label: 'Provisional parameters',
      value: PAPER_PARAMETERS.filter((parameter) => parameter.status === 'provisional').map((parameter) => parameter.key).join(', ') || 'none',
      note: 'Provisional values are used only inside an explicitly reviewed model configuration version.'
    },
    {
      label: 'Solver',
      value: `${SOLVER_DEFAULTS.method.toUpperCase()}, ${SOLVER_DEFAULTS.substepsPerYear} substeps per year, ${SOLVER_DEFAULTS.intervalMeanQuadrature} interval means`,
      note: 'The paper identifies no numerical solver, so this choice is an implementation decision, not a reported result.'
    },
    {
      label: 'Reported validation rows',
      value: `${PAPER_REPORTED_ACCURACY.table4.length} rows in Table 4 and ${PAPER_REPORTED_ACCURACY.table5.length} rows in Table 5`,
      note: 'The two tables disagree with each other about the same years.'
    },
    {
      label: 'Demo profile',
      value: DEMO_PROFILE_LABEL,
      note: 'Synthetic alpha and g values exist only to exercise the request path and are never a forecast.'
    }
  ],
  stations: [STUDY_AREA]
});

export function createResearchRouter(): Router {
  const router = Router();

  router.get('/', (_request, response) => {
    response.json(buildSummary());
  });

  return router;
}
