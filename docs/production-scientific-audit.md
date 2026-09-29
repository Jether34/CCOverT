# CCOverT scientific and production audit

This audit records the repository review performed before the current safety
changes. Line numbers are intentionally approximate because they move as the
code evolves; the referenced symbols are the stable locator.

| Finding | Severity | File / locator | Impact | Fix / current control |
|---|---|---|---|---|
| Paper values included unspecified `alpha` and `g` without a safe readiness gate | Critical | `services/model-api/ccover_model/model.py`, parameter validation | Could present a fabricated paper forecast | Missing values now refuse paper runs; demo and explicit scenario paths remain separate and labelled. |
| Carrying capacity was accepted above the 0–100 cover scale | High | `services/model-api/ccover_model/model.py`, `K` validation | Violated the stated measurement scale | `K` is now bounded to 0–100 in the solver and API. |
| Imported CSV shape checks could be mistaken for scientific validation | High | `apps/api/src/services/datasets.ts`, `importCsv` | Unreviewed SST/tourism data could drive a paper run | Imports are `needs-review`; only the documented review workflow can mark a traceable citywide series validated. |
| Dataset provenance lacked a content identity | High | `apps/api/src/services/datasets.ts`, dataset record | Results could not be reproduced after a file changed | SHA-256, provider, temporal/spatial coverage, retrieval/import time, and citation are persisted and copied into run provenance. |
| Baseline and series gaps could be silently interpolated/extrapolated | High | `apps/api/src/services/predictions.ts`, `valueAtYear` | A result could use an undocumented input year | Exact observed-year coverage is required; extrapolation needs a documented future implementation. |
| Model review could be self-approved | Critical | `apps/api/src/services/modelConfigService.ts` | Scientific sign-off would not be independent | Publishing is unreviewed-only; independent review creates a new immutable version and rejects the author. |
| Privileged access could be obtained through an email allowlist | Critical | `apps/api/src/routes/auth.ts`, bootstrap users | Public signup could grant researcher/admin access | Signup always creates `user`; privileged accounts require controlled bootstrap/admin workflow and verified email. |
| AI could receive unsupported PDF bytes as text | Critical | `apps/api/src/services/uploads.ts`, `apps/api/src/services/ai.ts` | Provider leakage/corrupt interpretation | Binary/unextracted documents are rejected unless text extraction succeeds; ownership checks remain enforced. |
| Ordinary users could browse researcher dataset/config inventories | Medium | `apps/api/src/routes/dataImports.ts`, `apps/api/src/routes/model.ts` | Violated role separation and exposed provenance workspace | Inventory/schema/version endpoints require researcher/admin; active model status remains available for users. |
| AI and developer configuration reads did not consistently require verified/privileged identity | High | `apps/api/src/routes/ai.ts`, `apps/api/src/routes/developer.ts` | Unverified users could access sensitive workflows | AI requires verified email; developer config requires admin. |
| Validation/calibration had no independent time split | Critical | `services/model-api/ccover_model/validation.py` | In-sample metrics could be misreported as validation | Time holdout and rolling-origin metrics, baselines, interval coverage, and dataset-version provenance are implemented; product labelling remains not validated until data exists. |
| Backup creation had no integrity/restore evidence | High | `apps/api/src/services/backupArchive.ts`, developer backup routes | A backup could be unusable during an incident | Archive manifest, gzip, checksum, and collection/count verification are checked; a real restore drill is still outstanding. |

## Readiness conclusion

- **Paper profile:** not configured for validated use.
- **Demo:** demo-ready in development environments where the demo flag is enabled.
- **Scenario:** scenario-ready for verified authenticated users with explicit assumptions.
- **Research:** not research-ready: independent SST/tourism/C0 data, reviewed parameters, and independent validation are still missing.
- **Production:** not production-ready: deployment secrets/providers, a tested MongoDB restore drill, external service checks, and a completed security/operations runbook still require deployment work.

The equation remains version `ccoverT-1.0.0`; no scientific term was changed.
