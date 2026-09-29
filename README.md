# CCOverT

CCOverT is a research workspace for modelling annual live coral cover in Puerto Princesa City, Palawan. It gives clients a focused prediction and history experience while giving researchers one controlled model configuration that is shared across client runs.

## What is included

- React and TypeScript web application with responsive client, researcher, and developer workspaces.
- Express API with authenticated sessions, role-based access, prediction history, reports, PDF downloads, and MongoDB persistence.
- Internal Python/FastAPI model service that owns the numerical calculation and continuous piecewise tourism growth.
- Researcher parameter controls for the single active model configuration. A saved parameter update is immediately used by subsequent client predictions.
- Clear yearly units and source notes for model parameters, with mathematical computation details retained in prediction history.
- Password visibility controls, protected account flows, reCAPTCHA, email verification for client accounts, and operational safeguards.

## Application areas

| Area | Purpose |
| --- | --- |
| Client workspace | Run predictions, review annual outputs, inspect computation breakdowns, browse history, and create reports. |
| Researcher workspace | Review and edit the active model parameters and publish one shared configuration for all users. |
| Developer workspace | Manage accounts, mail settings, backups, announcements, and operational activity. |

The public landing page contains the system overview, research context, team information, and resources. Signed-in users are routed to the workspace for their role.

## Model configuration

The application uses one active configuration for client predictions. Researchers can update numeric parameters and must provide a source or rationale for each change. Parameter guidance in the researcher interface identifies whether a value is an annual rate, temperature, annual arrival count, capacity, or derived/calculated value.

Tourism growth is continuous and piecewise: each period begins with the preceding period's ending value rather than resetting to the baseline. Forecast years beyond the last observed tourism year are generated mathematically by the model service.

Every saved prediction retains its profile, baseline and forecast years, parameter snapshot, configuration version, dataset coverage, warnings, provenance, and year-by-year computation values.

## Local development

Requirements: Node.js 22.12+, Python 3.12+, and npm.

```text
npm install
python -m pip install -r services/model-api/requirements.txt
copy .env.example .env
npm run dev
```

The development services use:

- Web: `http://localhost:5173`
- Express API: `http://localhost:4000`
- Model service: `http://localhost:8000`

For the containerized stack:

```text
copy .env.example .env
docker compose up --build
```

The web application is then available at `http://localhost:8080`. Keep real secrets in an ignored `.env` file or a deployment secret store. Never commit `.env`, `.env.local`, SMTP credentials, session secrets, reCAPTCHA secrets, or VPS configuration.

## Configuration essentials

- `SESSION_SECRET` — production session signing secret.
- `WEB_ORIGIN` and `APP_URL` — the public HTTPS origin.
- `MONGODB_URI` and `USE_MEMORY_DB` — persistence settings.
- `MODEL_SERVICE_URL` and `MODEL_SERVICE_TOKEN` — private API-to-model boundary.
- `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY` — client and server reCAPTCHA configuration.
- `SMTP_*` — production email delivery.
- `BOOTSTRAP_RESEARCHER_EMAILS` and `BOOTSTRAP_RESEARCHER_PASSWORD` — optional first-run researcher provisioning.

See [.env.example](.env.example), [the API documentation](docs/api.md), and [roles and operations](docs/roles-and-operations.md) for the available settings and access boundaries.

## Verification

```text
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:model
npm run smoke:model
git diff --check
```

## Repository layout

```text
apps/web/                 React/Vite client
apps/api/                 Express API and persistence boundary
packages/shared/          Shared types and domain rules
services/model-api/       Internal FastAPI numerical model service
docs/                     API, operations, and research documentation
docker-compose.yml        Local container stack
```

## Project author and stack

CCOverT is developed by Jether Garque. The project demonstrates full-stack product development across React, TypeScript, Vite, Express, Node.js, Python, FastAPI, MongoDB, Docker, REST APIs, authentication, scientific computation, responsive UI design, automated testing, and production operations.

For project updates and related work, visit [Jether Garque on GitHub](https://github.com/Jether34).
