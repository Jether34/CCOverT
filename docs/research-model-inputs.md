# CCOverT model-input audit

## Source inventory

The only CCOverT research file available to the project was `CCOverT_.docx` in the parent Downloads directory. Its SHA-256 at audit time was `4F8DE789352541C4A558D4FD7E221E828BBB82E9E2685D45E701750B4F5DD98C`. The attachment contains a title page, section **C. FINDINGS**, the model parameter table, reported cover tables, and a handwritten Appendix C calculation from which the complete update equation was transcribed.

The transcribed equation is implemented once, in `services/model-api`. The audit below records what is reported, what is inferred, and what remains unverified. Nothing marked unverified is presented as a confirmed research finding.

## Equation as transcribed

```text
dC/dt = r*C*(1 - C/K) - alpha*max(0, T(t) - Tcrit)*C - beta*V(t)*C
T(t)  = T0 + gamma*t
V(t)  = V0*exp(g*t)
```

`C` and `K` are percentage points on a 0–100 scale, `T` is sea-surface temperature in degrees Celsius, `t` is years from the baseline, and `V` is annual tourist arrivals for the city. The application does not substitute air temperature for SST, and it does not add rainfall, humidity, wind, or DHW.

## Confirmed text from the attachment

| Item | Confirmed detail | Source location |
| --- | --- | --- |
| Target | Live coral cover is labeled `%LCC (HC+SC)`, where `HC` means hard coral and `SC` means soft coral. | Table 1 note |
| Equation | The full update equation appears in the handwritten Appendix C calculation. | Appendix C |
| Explicit environmental variable | Sea-surface temperature (SST) / temperature is named. | Findings, Problems 2–3 discussion |
| Temperature-stress term | Stress is zero while temperature does not exceed the critical threshold. | Appendix C |
| Growth term | Intrinsic coral-cover growth with logistic saturation `r*C*(1 - C/K)`. | Appendix C |
| Recovery term | Natural recovery rate `r` is named. | Findings and Problem 5 |
| Tourism term | `beta*V(t)*C(t)` is named, with `V(t)` growing exponentially. | Appendix C |
| Tourism threshold | `V(t) > 89,879` is reported. | Findings, Problem 5 |
| 2006 average | 57.25% live coral cover is reported in Table 1. | Table 1 |
| 2016 average | 46.2% live coral cover is reported in Table 1. | Table 1 |
| 2036 projection | 18% live coral cover is reported in Table 2. | Table 2 |
| Reported growth | Growth increased from 0.29 in 2006 to 0.40 in 2036; no unit or calculation detail is given. | Figure 2 discussion |
| Reported temperature stress | Stress remained 0 in the plotted period because temperature did not exceed the critical threshold. | Figure 4 discussion |
| Reported tourism pattern | Tourism impact rose until before 2020 and increased again from 2023. | Figures 3–4 discussion |

## Parameter register

| Symbol | Value | Unit | Status | Verification note |
| --- | --- | --- | --- | --- |
| `r` | 0.028 | per year | reported | Parameter table. |
| `K` | 70 | percent | provisional | Carrying capacity is not justified in the attachment; flagged in every result. |
| `alpha` | none | per degree Celsius per year | unspecified in paper | Required when SST can exceed `Tcrit` in the requested horizon. If it cannot, the thermal term is exactly zero and the run records `not-required-for-horizon`; no configured alpha is inferred. |
| `Tcrit` | 31 | degrees Celsius | reported | Parameter table. |
| `T0` | 30.19 | degrees Celsius | reported | Source should be confirmed as SST. |
| `gamma` | 0.013 | degrees Celsius per year | reported | Linear SST trend. |
| `beta` | 5.6743e-8 | per tourist arrival per year (inferred) | provisional | Back-calculated from the Appendix C arithmetic; the paper does not state the unit. |
| `V0` | 147806 | annual tourist arrivals | reported | Baseline citywide arrivals. |
| `g` | none | per year | unspecified in paper | Required by the equation. A data fit is offered as an informational derived value only. |

## Derived values are not paper values

Fitting `g` to the reported 2006 and 2016 cover with `alpha = 0` gives roughly 0.21 per year. That number is a property of this dataset and this assumption, not a published coefficient. It is stored as a derived value on the dataset, carries the model configuration version it was fitted against, and must be adopted through a new reviewed configuration version before it affects any run. The stored run keeps its warnings, including this one.

## Known inconsistencies and interpretation limits

1. Table 4 lists 2006 observed and predicted cover as 45.83%/45.83%, while other sections report 57% or 57.25% for 2006.
2. Table 4 and Table 5 use different reported prediction values for 2016.
3. The MAE table and prose do not agree on the error calculation; the prose appears to average a repeated 0.30% term. The reported MAE of 0.30 is displayed as printed and never used as evidence of accuracy.
4. The MAPE explanation says 20% means predictions match actual values; that interpretation is incorrect and is not used.
5. A t-test based on two reported years cannot establish predictive accuracy. The application does not claim to validate the paper model.
6. The listed condition ranges leave exactly 75% unassigned. The application uses its own documented convention, labelled as an analyst decision.
7. The appendix PAGASA pages are meteorological-station air temperature, not a verified SST series, and no conversion is documented.
8. Reef-site observations are not interchangeable with the citywide scope the model is defined for, so they are excluded from model inputs.

## Information still required

1. A published source for `alpha`, with units and an effective date.
2. A defensible basis for `K`, and confirmation of the `beta` unit.
3. A cited SST series and a cited tourist-arrivals series, imported with citations and units.
4. Station coordinates and matching rules, if per-station reporting is ever wanted.
5. An independent validation dataset, which is the only way to support any accuracy claim.
