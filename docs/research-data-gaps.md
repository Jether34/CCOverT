# CCOverT research and deployment data gaps

This register is part of the product boundary. A demo or exploratory scenario may run with explicit assumptions, but these gaps must be resolved before a result is presented as a validated paper-profile finding.

## Scientific inputs

| Input | Current value/status | Unit | Source or gap | Product requirement |
| --- | --- | --- | --- | --- |
| `alpha` | Not numerically specified | per degree Celsius per year | The paper gives the thermal term but no numeric coefficient | A researcher must publish a cited value for paper readiness. A scenario may supply it; if SST never exceeds `Tcrit` in the selected horizon, record it as inactive/not required and use an exactly zero thermal term. |
| `g` | Not numerically specified | per year | The paper gives `V(t)=V0*exp(g*t)` but no numeric growth rate | Estimate only from a documented annual tourist-arrivals series or provide an explicit scenario assumption. Never substitute zero. |
| `T0` | `30.19` provisional reported value | degrees Celsius | The paper source must be verified as sea-surface temperature (SST), not PAGASA air temperature | Attach a dated SST source or mark the paper profile not configured. |
| `gamma` | `0.013` reported value | degrees Celsius per year | Paper parameter table; SST provenance needs confirmation | Confirm the trend was derived from SST and record its source dataset/version. |
| `Tcrit` | `31` reported value | degrees Celsius | Paper parameter table | Confirm threshold definition and SST measurement basis. |
| `V0` | `147,806` for 2006 | annual tourist arrivals | Paper parameter table; citywide coverage needs confirmation | Use annual arrivals for Puerto Princesa City and record provider, coverage, retrieval/import date, and units. |
| `K` | `70` provisional | live coral-cover percentage points (0–100 scale) | Handwritten sample calculation | Confirm carrying-capacity interpretation and retain provisional status until reviewed. |
| `beta` | `5.6743e-8` provisional | unclear; likely related to arrivals and year | Handwritten sample calculation | Confirm coefficient units and whether arrivals are annual citywide arrivals. |
| `r` | `0.028` | per year | Paper parameter table | Confirm citation and review status. |
| `C0` | No default selected by the UI | percentage points on 0–100 scale | Paper reports conflicting values around `57%`, `57.25%`, and `45.83%` for 2006 | Every run must provide a dated, cited citywide baseline. The product must not silently select one disputed value. |

## Data sources still required

- A documented SST provider or CSV import for Puerto Princesa City, with annual coverage, units in degrees Celsius, spatial scope, retrieval/import date, and a clear statement that it is SST rather than air temperature.
- A documented annual tourist-arrivals provider or CSV import for Puerto Princesa City. Reef-site visitor counts and generic tourism indicators are not interchangeable with citywide annual arrivals.
- A reviewed citywide coral-cover baseline source for each run. The source citation must include the source year and the researcher’s scope confirmation. The Predict page offers the figures the paper actually prints as an explicit choice (`PAPER_BASELINE_OPTIONS`), so the conflict is visible instead of being resolved by a hidden default. Cover, year, and citation are filled together and held locked to one another so a value cannot drift from the table it came from, and every option ships a citation the API accepts without the user retyping the year. Choosing "My own survey" clears them for an analyst-supplied figure. Whatever is selected is stored in the run's `sources` entry.
- Provenance links for any fitted `g`, including the exact dataset version and the log-linear estimation method used by the import workflow.

## Product and configuration gaps

- The runnable `paper-reproduction` profile is versioned as `paper-reproduction-1.0.0` and uses alpha `0.05`, C0 `57%` in 2006, and the continuous `piecewise-tourism-1.0.0` schedule (2006-2016: `0.213314`; 2017-2022: `0`; 2023 onward: `0.128708`). It is an auditable reproduction configuration, not a validated paper profile. K and beta remain provisional/inferred, and the conflicting paper baselines remain visible.
- The piecewise schedule is a configured reproduction input. A researcher still needs to attach and review authoritative SST and citywide tourism datasets before any result can be called research-ready; attached datasets are retained as provenance and do not silently replace the confirmed reproduction constants.

- The paper profile remains not configured until `alpha`, `g`, SST provenance, tourism scope, and the required reviewed inputs are resolved.
- Demo values for `alpha` and `g` are synthetic development values only and must remain excluded from validated accuracy reporting.
- Scenario values need a rationale, unit, optional range, selected base profile, and an explicit “Assumption—not a validated finding” label in UI, API responses, history, downloads, and AI reports.
- The paper does not specify a numerical solver or within-year averaging rule. CCOverT currently uses RK4 with 12 substeps/year, trapezoid interval means, and end-of-year output; this convention is stored with each run but is not a paper-validated method.
- The paper’s reported MAE is not independently verified. No product accuracy report should present it as validated.
- Current weather display must remain separate from model SST inputs and must never silently populate `T(t)`.
- The model is a Puerto Princesa Citywide annual-average model. GPS consent may be retained as context only and must not become a reef-site forecast.
- A production deployment still needs an approved SST provider, tourism provider, dataset retention policy, model-profile review workflow, and an AI provider configuration if non-deterministic report interpretation is enabled.
