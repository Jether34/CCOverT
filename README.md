# CCOverT

CCOverT is a mobile-first research workspace for **citywide annual live coral cover in Puerto Princesa City, Palawan**. It combines a React/TypeScript client, an authenticated Express API, MongoDB-backed persistence, and an internal Python/FastAPI model service.

**Research status:** the paper profile is not yet configured for validated predictions. Missing and conflicting scientific inputs are documented in [research data gaps](docs/research-data-gaps.md). Synthetic demo and explicit scenario results are labelled as such; they are not validated findings. The model does not make reef-site predictions from arbitrary GPS coordinates.

Start with [local development](#local-development), [roles and operations](docs/roles-and-operations.md), [API documentation](docs/api.md), or [model limitations](docs/model-limitations.md).

## Evidence gate

The research attachment `CCOverT_.docx` supplies the title page, the equation as used in the handwritten Appendix C calculation, the parameter table, and reported cover figures. It does not supply two parameters, and it contradicts itself in places. The application therefore implements the published equation and keeps the paper profile unconfigured until a researcher resolves the gaps from cited sources.

- The Python model service runs the deterministic CCOverT equation; the Express API never re-implements the mathematics.
- The paper profile refuses to run while `alpha` (thermal mortality) or `g` (tourism growth) has no reviewed value: `MODEL_PARAMETERS_NOT_CONFIGURED`. The one narrow exception is an inactive thermal horizon: if SST never exceeds `Tcrit`, the thermal term is exactly zero and the run records alpha as `not-required-for-horizon`; the paper profile still remains globally not configured.
- A data-derived `g` is offered as an informational derived value and must be adopted through a reviewed model configuration version; it never silently overrides a run.
- The UI never presents a paper reference value as a newly calculated prediction.
- Paper-reported values and inconsistencies are documented in `docs/research-model-inputs.md` and `docs/model-limitations.md`.
- The supported target is `%LCC (HC+SC)`, where `HC` is hard coral and `SC` is soft coral.
- SST is the only confirmed model-input fragment. No rainfall, humidity, wind, DHW, or other unverified variable is added.
- Default stations are reference-only because verified coordinates were not present in the attachment.
- The DEMO profile uses synthetic `alpha` and `g`, is refused in production, and labels every result it produces.
- An exploratory `scenario` run is the way to compute with an unconfigured `g`, or with an `alpha` that is needed by the requested horizon. The user supplies each required value with a rationale and optional range; the run is permanently labelled, counted separately from validated predictions, and never promotes an assumption to a reviewed value.

## Local development

Requirements: Node.js 22.12 or newer, Python 3.12 or newer, and npm.

```text
npm install
python -m pip install -r services/model-api/requirements.txt
copy .env.example .env
npm run dev
```

The development command starts:

- Web client: `http://localhost:5173`
- Express API: `http://localhost:4000`
- Internal model service: `http://localhost:8000`

The Vite development server proxies `/api` to the Express API. With no MongoDB URI, the API uses its in-memory development store. In development without SMTP, signup responses include a development verification URL; do not use that mode for production.

`npm run dev` starts the web client, the Express API, and the internal model service. It does not start MongoDB or Mailpit; those come from `docker compose up`, and on a host without Docker the API must use the in-memory store and a real SMTP or development verification URL.

To run services separately:

```text
npm run dev:model
npm run dev:api
npm run dev:web
```

## Configuration

Copy `.env.example` to `.env` and set secrets locally. Important variables:

- `SESSION_SECRET`: required in production and must be a non-placeholder value of at least 32 characters.
- `WEB_ORIGIN`: comma-separated browser origins allowed by CORS and same-origin checks. Ignored while `NODE_ENV=development`, where every origin is accepted so local work is not blocked by a hostname or port spelling; it is enforced in every other environment.
- `APP_URL`: base URL used in verification links.
- `DOCKER_WEB_ORIGIN` and `DOCKER_APP_URL`: Compose browser origins for the port-8080 web service.
- `TRUST_PROXY`: enable only when the API is behind a trusted one-hop reverse proxy, as in the Compose stack.
- `MONGODB_URI` and `USE_MEMORY_DB`: choose MongoDB or the development memory store.
- `MODEL_SERVICE_URL`: internal FastAPI URL; never expose this service directly to browsers.
- `MODEL_SERVICE_TOKEN`: shared secret sent by the API as the `x-service-token` header. Required, and at least 24 characters in production. The model service rejects requests without it and refuses every route in production when it is unset.
- `MODEL_ALLOW_DEMO_PROFILE`: enables the synthetic DEMO profile in the model service. It is always refused when `NODE_ENV=production`.
- `ALLOW_DEMO_PROFILE`: the matching API-side switch.
- `AI_PROVIDER`, `ENVIRONMENTAL_PROVIDER`: provider boundaries; both default to `disabled`.
- `SMTP_*`: email verification delivery in a deployed environment.
- `REEF_STATIONS_JSON`: optional verified station configuration. Coordinates must be supplied from an authoritative source.

Provider integrations are intentionally not bundled. An unconfigured provider returns an explicit unavailable state rather than fabricated data.

## Docker Compose

Docker Compose is the containerized local stack. Create `.env` first and set a real `SESSION_SECRET`:

```text
copy .env.example .env
```

Set `SESSION_SECRET` and `MODEL_SERVICE_TOKEN` in `.env`, then run:

```text
docker compose up --build
```

The web client is exposed at `http://localhost:8080`; the API and model service are reachable only on the internal Compose networks. Mailpit is exposed at `http://localhost:8025` for development mail, and `SMTP_HOST=mailpit` with `SMTP_PORT=1025` delivers into it. Uploads are written to the private `UPLOAD_DIR` of the API container and are never served by the web container. The Compose defaults intentionally use HTTP and `COOKIE_SECURE=false` for local development.

For a deployed environment, use `NODE_ENV=production`, HTTPS, a non-development SMTP configuration, and a managed secret store. The API forces secure cookies and disables development verification links whenever `NODE_ENV=production`; `COOKIE_SECURE=false` is only for the local HTTP stack. Put the web service behind a TLS proxy.

## Verification commands

```text
npm run build
npm run typecheck
npm run test
npm run lint
```

The model tests can also be run directly:

```text
npm run test:model
```

which is equivalent to `python -m unittest discover -s services/model-api/tests -t services/model-api -p "test_*.py"`.

The API tests run against a contract double, so they cannot catch drift between the TypeScript request shape and the model service's own `PredictRequest`. With the stack running, check that boundary against the real service:

```text
npm run smoke:model
```

It posts the body the API actually sends, straight at `POST /model/predict`, and asserts a scenario run is labelled exploratory, echoes assumed values as `assumed`/`unreviewed`, keeps `K` and `beta` provisional, and still refuses a scenario with no values. It reads `MODEL_SERVICE_URL` and `MODEL_SERVICE_TOKEN` from the environment, so on PowerShell run `$env:MODEL_SERVICE_TOKEN = (Get-Content .env | Select-String '^MODEL_SERVICE_TOKEN=').Line.Split('=', 2)[1]` first if the token is set.

The test suite covers shared classification safety, API validation, email verification, authentication, ownership isolation, per-route rate limiting, model-service gating, CSV import and validation, model configuration versioning, deterministic PDF and text extraction, prediction idempotency, downloads, deterministic AI reports, dashboard scoping, and a full researcher workflow driven by a contract double that replays recorded FastAPI responses. The Python suite covers the RK4 integrator, parameter handling, missing-parameter refusal, condition classification, and parameter calibration.

## Application areas

- **User:** dashboard, prediction runs, own history and downloads, AI interpretation, and personal settings. Signup includes email verification. Users cannot import or configure shared research data.
- **Researcher:** sourced SST and tourism imports (including a year-aware Excel workbook template), model-version publication, and shared dataset selection. The active version applies to subsequent predictions; saved predictions retain their input snapshots.
- **Developer:** account and role management, SMTP and operational settings, process activity, and MongoDB backup inventory. The API role name is `admin`; the interface calls it Developer.

All roles have distinct protected dashboard views. See [roles and operations](docs/roles-and-operations.md) for the exact access boundaries and backup limitations.

## Security boundaries

- Passwords are hashed with bcrypt.
- Sessions use signed, HttpOnly cookies.
- Email verification is required for predictions, history, and AI.
- Every prediction and AI record lookup is scoped to the authenticated owner.
- Uploads are size-limited, MIME/extension checked, hashed, and written to a private directory that the web service never serves. Text, CSV, JSON, and simple PDFs get a bounded extracted preview for citations; a PDF with an unsupported font encoding is reported as `extraction-unsupported` instead of being guessed at.
- API and provider errors are returned as structured states without exposing credentials or internal implementation details.
- Helmet, CORS, same-origin checks, and per-route rate limits are enabled. Rate limiting is always active in production and disabled only under `NODE_ENV=test`.
- The same-origin check and the CORS allowlist are bypassed only under `NODE_ENV=development`. `production` enforces the exact `WEB_ORIGIN` list, so a hostile page cannot make a state-changing request or read a response.

## Repository layout

```text
apps/web/                 React/Vite client
apps/api/                 Express API and persistence boundary
packages/shared/          Shared types, paper constants, classification rules
services/model-api/       Internal FastAPI model service (only place the equation runs)
docs/                     Research audit, API contract, and limitations
docker-compose.yml        Containerized local stack
```
