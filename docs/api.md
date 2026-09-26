# API reference

The browser uses the Express API under `/api/v1`. The FastAPI model service is internal, is never exposed by the browser-facing Compose configuration, and requires the shared `x-service-token` header on every route except its health probes.

Base URL: `/api/v1`

## Authentication

- `POST /auth/signup` — body `{ email, password }`; creates an account and starts verification.
- `POST /auth/verify` — body `{ token }`; verifies an email.
- `POST /auth/login` — body `{ email, password }`; sets an HttpOnly session cookie.
- `POST /auth/logout` — clears the session cookie.
- `POST /auth/forgot-password` — body `{ email }`; requests a single-use reset link. The response is identical whether or not the address exists.
- `POST /auth/reset-password` — body `{ token, password }`; consumes the reset token.
- `GET /auth/me` — returns the current user.

In development only, when SMTP is not configured, signup may return a one-time verification URL. Production responses and logs never contain verification or reset tokens.

## Research, stations, and settings

- `GET /research` — the shared `ResearchSummary`: paper-reported values, equations, condition convention, paper conflicts, and reference diagnostics. Reference data only.
- `GET /dashboard` — the authenticated user's counts, recent runs, location status, and model status.
- `GET /settings`, `PATCH /settings` — display and language preferences.

## Model configuration

- `GET /model/status` — readiness, active configuration version, missing parameters, provisional parameters, condition convention, solver, paper conflicts, and the equation and model versions confirmed by the model service.
- `GET /model/parameters` — the parameter register with provenance and review state.
- `GET /model/conditions` — the condition bands and their analyst-defined source.
- `GET /model/demo-availability` — whether the synthetic DEMO profile is permitted. Always false in production.
- `GET /model/versions` — configuration history (authenticated).
- `POST /model/versions` — body `{ baseVersion, changes, notes, reviewStatus, effectiveDate?, sourceDatasetIds? }`; creates a new immutable version and activates it. Researcher or admin only, and every referenced source dataset must belong to the caller.
- `POST /model/versions/:id/activate` — admin only.

A run is refused with `MODEL_PARAMETERS_NOT_CONFIGURED` while any required parameter has no value, except that missing `alpha` is allowed when the linear SST driver never exceeds `Tcrit` over the requested horizon. That run records `alpha` as `not-required-for-horizon`; it is not a defaulted or configured zero.

## Sourced data

- `GET /data-imports?kind=sst|tourism|coral-cover` — the caller's datasets with records, units, and derived values.
- `GET /data-imports/schema/:kind` — the expected CSV columns, units, and minimum record count.
- `POST /data-imports` — multipart `file` plus `kind`, `label`, `sourceCitation`, `unit`, `scope`, `spatialCoverage`, `reviewStatus`. Researcher or admin only.
- `POST /data-imports/:id/estimate-g` — fits `g` against an imported coral-cover series. The fit is performed by the model service, not in TypeScript, and requires a configured starting value for `g`. The result is stored as a derived value only.

## Predictions

- `POST /predictions` — body `{ studyAreaId, scope, profile, baselineYear, horizonYears, coralBaseline, sstDatasetId?, tourismDatasetId?, consentedLocation?, solver, assumedValues? }`. Requires a verified account. Honors the `Idempotency-Key` header: an identical replay returns the stored run with `replayed: true`, and a different body under the same key returns `IDEMPOTENCY_CONFLICT`.
- `profile` is `paper`, `demo`, or `scenario`:
  - `paper` uses the active model configuration and is refused while any required parameter needed by the requested horizon has no value. Missing alpha is allowed only for an inactive thermal horizon, and the global paper readiness state remains `Not configured`.
  - `demo` uses synthetic values and is only available outside production.
  - `scenario` is an exploratory run that supplies the missing parameters itself.
- `GET /predictions` — only the authenticated user's records.
- `GET /predictions/:id` — an owned run.
- `GET /predictions/:id/download?format=markdown|csv|json` — a downloadable report, CSV series with parameter and source blocks, or the stored record.
- `GET /predictions/:id/reports` — AI reports generated for an owned run.

A stored run keeps the input snapshot, the model configuration version, the equation and model versions, per-year decomposition into growth, thermal, and tourism contributions, source records, and every warning raised during the run. A refused or failed run is never stored.

## Exploratory scenario runs

`profile: 'scenario'` lets a verified user run the model while `g`, or horizon-required `alpha`, still has no configured value, by naming the assumptions out loud instead of having a default silently substituted.

- `assumedValues` is a non-empty array of `{ key, value, unit, rationale, range? }`. `rationale` is required, keys are unique, and `range` is an optional `{ min, max }` that must not run backwards and must contain the value. The range is carried into the stored record, the downloadable report, and the result screen.
- An assumption only fills a value that is missing. It never replaces a configured or imported value; a submission for an already-configured parameter is ignored and the run records a warning saying it was not applied.
- A scenario must still supply every parameter that remains missing, except alpha when the thermal term is inactive for the requested horizon. Otherwise the request is refused with `SCENARIO_ASSUMPTIONS_INCOMPLETE`. On the paper profile, a non-empty `assumedValues` is refused.
- Assumed parameters are stored with `status: 'assumed'` and `reviewStatus: 'unreviewed'`, and they reach the model service with that provenance attached.
- The response sets `isScenario: true`, the profile reads `scenario`, and warnings state that the run is not a validated prediction. Scenario runs are excluded from validated-prediction counts, and any report that includes one labels it and repeats the caveat.
- Scenario runs are exploratory, not findings. They never make a configuration reviewed, and they are stored with the model configuration version they were computed against.

## Uploads

- `GET /uploads` — the caller's uploads.
- `POST /uploads` — multipart `file`; PDF, TXT, CSV, or JSON up to the configured size. Files are hashed and written to a private directory the web service never serves.
- `DELETE /uploads/:id` — deletes an owned upload and its stored bytes.

Text-like files and simple PDFs receive a bounded extracted preview. A PDF whose font encoding cannot be read is reported as `extraction-unsupported` with no preview, rather than being decoded into text that may be wrong.

## AI

- `GET /ai/status` — provider state and the deterministic fallback notice.
- `POST /ai/reports` — body `{ predictionIds?, predictionId?, uploadIds?, question? }`; returns a report with citations.
- `GET /ai/reports` and `GET /ai/reports/:id` — the caller's reports.

With no provider configured, reports are deterministic summaries of stored numbers and always carry that warning; `provider` is `null`. A provider can explain authorized records but cannot change a numerical output.

## Error shape

```json
{
  "error": {
    "code": "MODEL_PARAMETERS_NOT_CONFIGURED",
    "message": "The model cannot run until these parameters have a reviewed value.",
    "details": { "missingParameters": ["alpha", "g"] },
    "requestId": "0f1c..."
  }
}
```

Zod validation failures return 400, oversized uploads 413, and route rate limits return 429. All prediction, upload, dataset, and AI-report reads and updates are scoped to the authenticated user; the server never trusts a client-supplied user ID.
