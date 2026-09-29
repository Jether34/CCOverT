# Model limitations

## Current status

The CCOverT equation is implemented once, in the internal Python service, using the form recorded from the paper and its handwritten Appendix C calculation:

```text
dC/dt = r*C*(1 - C/K) - alpha*max(0, T(t) - Tcrit)*C - beta*V(t)*C
T(t)  = T0 + gamma*t
V(t)  = V0*exp(g*t)
```

Two parameters are not specified in the attachment: `alpha` (thermal mortality) and `g` (tourism growth). The paper profile remains globally not configured until a researcher supplies reviewed values through a model configuration version. For a specific horizon, a missing `alpha` does not block only when the linear SST driver never exceeds `Tcrit`; the thermal term is then exactly zero and the run records `alpha` as `not-required-for-horizon`. Every other parameter carries a status, a provenance string, and a review state. A labelled exploratory scenario, described below, lets a user name assumptions instead of the system choosing them.

## Safe behavior

- `POST /api/v1/predictions` returns `MODEL_PARAMETERS_NOT_CONFIGURED` while a required parameter lacks a value, except for a missing `alpha` whose SST driver stays at or below `Tcrit` over the requested horizon. That exception is recorded explicitly and is not a configured alpha value.
- `POST /model/predict` on the internal service returns the same state and never fabricates an estimate.
- A failed or refused run is never stored as a prediction; persistence is all-or-nothing after the upstream call succeeds.
- Paper-reported averages and projections are visually and semantically separated from model outputs.
- The target is `%LCC (HC+SC)`; separate hard-coral and soft-coral targets are not offered.
- Air temperature is never substituted for SST, and no current-time value is used as an annual predictor.
- A configured environmental provider alone does not make the model ready.
- A dataset is never validated by parsing it. Only an admin review can set `validated`, and only against a series that already carries its provenance.
- A configuration version is never reviewed by its author. Publication and independent sign-off are separate, separately authorised acts.
- A configured AI provider can explain authorized records but cannot change numerical outputs.
- A derived `g` from an imported series is informational. It never overrides the configured value inside a run; adopting it creates a new, reviewed configuration version.
- Replacing a configured `T0`, `gamma`, or `V0` with an imported series adds a visible warning to the stored run instead of changing the model silently.

## Exploratory scenarios

The strict rule above is relaxed by two deliberate, narrow paths. A missing alpha is allowed only when the SST driver cannot activate its threshold term for the requested horizon. Otherwise, a verified user may supply `alpha` and/or `g` as explicit scenario assumptions, each with a value, a unit, a written rationale, and optionally a min/max range. These paths exist so the alternative is an explicit, labelled result rather than a hidden default.

The constraints that keep this from being a silent default still hold:

- An assumption never overwrites a configured or imported value. Submitting one for an already-configured parameter is ignored, and the run records a warning that it was not applied.
- An assumption is never treated as evidence. It is stored with `status: 'assumed'` and `reviewStatus: 'unreviewed'`, and adopting it as the real value is a separate act that creates a reviewed configuration version.
- A scenario is not a finding. It is permanently labelled `isScenario: true`, is excluded from validated-prediction counts, and any report including it repeats the caveat.
- The paper profile's global readiness state is unaffected. It still refuses a missing value when that value is needed for the requested horizon, and it refuses `assumedValues` outright.
- A scenario still needs every missing value except alpha when the thermal term is proven inactive for that horizon. Supplying one assumption does not authorize a run that would otherwise be refused.
- `K` and `beta` keep their provisional, unreviewed status inside a scenario run. Assuming `alpha` and `g` does not promote them.
- A scenario is bounded by the same refusal rules as any other run: it cannot run against the DEMO profile, and an unconsented study area is still refused.

## Implementation choices that are not reported results

- The paper names no numerical solver. This implementation uses classical RK4 with 12 substeps per year and reports both the end-of-year state and the trapezoidal interval mean.
- The condition bands are an analyst-defined convention, not a published classification. The paper does not state which class includes 75 percent.
- The reported MAE of 0.30 cannot be reproduced: Table 4 and Table 5 disagree about the 2006 observed cover, and the arithmetic in the appendix does not reconstruct the printed error.
- The appendix PAGASA pages are meteorological-station air temperature, not a verified sea-surface-temperature series, and no conversion is documented.
- Reef-site observations are not interchangeable with the citywide scope the model is defined for, so they are excluded from model inputs.

## Readiness gates and how they are satisfied

Two structural gaps previously made the paper profile unreachable. Both are now closed, and the gates below are real rather than aspirational.

- **Dataset validation is admin-only.** `importCsv` always stores `needs-review`; a client-supplied `validated` is accepted by request validation and then discarded, so parsing success can never be mistaken for scientific review. `POST /api/v1/data-imports/:id/review` (`requireRole('admin')` plus same-origin) is the only path that sets `validated`, `needs-review`, or `rejected`. It requires a written note, records the reviewing admin and timestamp, and refuses `validated` unless the series already carries a citation, a named provider, a SHA-256 checksum, citywide annual-average scope, at least two observations, and — for SST — a source that is not station air temperature.
- **Independent configuration review is a separate act by a different person.** `POST /api/v1/model/versions` still refuses `reviewStatus: 'reviewed'`, so publication and sign-off can never be the same action. `POST /api/v1/model/versions/review` publishes a *new* version carrying `reviewStatus: 'reviewed'`, `reviewedBy`, and `reviewedVersion`, because published versions are immutable. It refuses the author of the version under review, refuses a version that already has a review successor, and requires a written note.
- **A review does not launder a provisional value.** Reviewing attests to the version as published; `provisional`, `assumed`, and `synthetic-demo-only` parameters keep their status, so `paperReadiness` continues to report `K` and `beta` until an author republishes them as configured and a different reviewer signs off again.

Reaching a research-ready paper profile therefore requires a reviewed SST series, a reviewed citywide arrivals series covering the baseline year, a published configuration with every parameter configured, and an independent review of that version. No step fabricates a scientific judgement.

`services/model-api/ccover_model/validation.py` implements the independent-evaluation capability this depends on — a time-split holdout, three baselines, rolling origins restricted to training years, bounded nonlinear least squares for `alpha` and `beta`, and bootstrap 95% intervals — and is now reachable at `POST /model/validate` behind the service token. It reports metrics and exploratory fits and marks nothing validated; the endpoint refuses to fit a missing parameter and refuses to fit `alpha` when the thermal term never activates, because `alpha` is then unidentifiable. A fitted value still has to be adopted through a reviewed configuration version.

## Data limitations

The attachment gives reef-site names and selected cover values but no station coordinates, sampling protocol, environmental time series, or complete data-source citations. The default station list is consequently reference-only, and a location consent is stored as context only. Environmental inputs remain unavailable until a cited series is imported and a station configuration is supplied from an authoritative source.

## What a future release needs

A new model release must ship a versioned equation source, parameter set, supported-input list, units, time windows, and reproducible verification vectors. The model service must keep rejecting requests unless every required input is present, valid, and traceable to a source and retrieval time, subject only to the explicit inactive-alpha horizon exception; each stored result must retain its input snapshot and model configuration version.
