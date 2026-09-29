"""Internal FastAPI service that evaluates the CCOverT equation.

This service is not a public API. It is reachable only on the private network,
and the Express API authenticates to it with a service token. Browsers never
call it directly.
"""

from __future__ import annotations

import hmac
import os
import uuid
from typing import Any, Optional

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .model import (
    ModelParameters,
    ModelValidationError,
    ParametersNotConfiguredError,
    SolverSettings,
    calibrate_parameter,
    demo_profile_warning,
    metadata,
    simulate,
    status_for,
    thermal_term_inactive_for_horizon,
)
from .parameters import (
    CONDITION_CONVENTION,
    DEMO_PROFILE,
    DEMO_SYNTHETIC_PARAMETERS,
    PAPER_REPRODUCTION_LABEL,
    EQUATION_SOURCE,
    EQUATION_VERSION,
    MODEL_VERSION,
    PAPER_PARAMETERS_BY_KEY,
    REQUIRED_PARAMETER_KEYS,
    STATUS_SYNTHETIC_DEMO,
)
from .schemas import (
    AnnualOutput,
    CalibrateRequest,
    CalibrateResponse,
    ParameterEcho,
    PredictRequest,
    PredictResponse,
    SolverEcho,
    ValidationRequest,
)
from .validation import evaluate_time_split, fit_alpha_beta_g

SERVICE_TOKEN_HEADER = "x-service-token"
REQUEST_ID_HEADER = "x-request-id"

SOLVER_NOTES = (
    "The paper does not identify a numerical solver or define within-year averaging. "
    "This run used classical fourth-order Runge-Kutta with a fixed substep per year and "
    "reports both the end-of-year state and the trapezoidal interval mean of live coral cover."
)

app = FastAPI(
    title="CCOverT internal model service",
    version=EQUATION_VERSION,
    description=(
        "Deterministic evaluation of the published CCOverT coral-cover equation. "
        "Internal service: call through the Express API."
    ),
    docs_url=None,
    redoc_url=None,
    openapi_url="/internal/openapi.json",
)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _configured_service_token() -> str:
    return (os.getenv("MODEL_SERVICE_TOKEN") or "").strip()


def _demo_profile_allowed() -> bool:
    if (os.getenv("NODE_ENV") or "development").strip().lower() in {"production", "staging"}:
        return False
    return _env_flag("MODEL_ALLOW_DEMO_PROFILE", False)


@app.middleware("http")
async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
    incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
    request_id = incoming[:120] if incoming else uuid.uuid4().hex
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:  # pragma: no cover - defensive
        response = JSONResponse(
            status_code=500,
            content={"error": {"code": "INTERNAL_ERROR", "message": "The model service failed to handle the request.", "requestId": request_id}},
        )
    response.headers[REQUEST_ID_HEADER] = request_id
    response.headers["Cache-Control"] = "no-store"
    return response


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", uuid.uuid4().hex)


def _error(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: Optional[dict[str, Any]] = None,
) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message, "requestId": _request_id(request)}
    if details:
        body["details"] = details
    return JSONResponse(status_code=status_code, content={"error": body})


def require_service_token(x_service_token: Optional[str] = Header(default=None)) -> None:
    """Reject callers that do not present the configured service token."""

    expected = _configured_service_token()
    if not expected:
        return
    provided = (x_service_token or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise _ServiceTokenRejected()


class _ServiceTokenRejected(Exception):
    """Raised when the service token is missing or does not match."""


@app.exception_handler(_ServiceTokenRejected)
async def _service_token_handler(request: Request, _exception: _ServiceTokenRejected) -> JSONResponse:
    return _error(request, 401, "SERVICE_TOKEN_INVALID", "A valid model-service token is required.")


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exception: RequestValidationError) -> JSONResponse:
    return _error(
        request,
        422,
        "VALIDATION_ERROR",
        "The prediction request could not be validated.",
        {"fields": _summarise_validation_error(exception)},
    )


def _summarise_validation_error(exception: RequestValidationError) -> list[dict[str, Any]]:
    summary: list[dict[str, Any]] = []
    for item in exception.errors():
        location = ".".join(str(part) for part in item.get("loc", ()) if part != "body")
        summary.append({"field": location or "body", "reason": item.get("msg", "invalid value")})
    return summary


@app.exception_handler(ModelValidationError)
async def _model_validation_handler(request: Request, exception: ModelValidationError) -> JSONResponse:
    return _error(
        request,
        422,
        "MODEL_INPUT_INVALID",
        "A model input is outside the range the equation can accept.",
        {"fields": [exception.to_dict()]},
    )


@app.exception_handler(ParametersNotConfiguredError)
async def _parameters_missing_handler(request: Request, exception: ParametersNotConfiguredError) -> JSONResponse:
    return _error(
        request,
        409,
        "MODEL_PARAMETERS_NOT_CONFIGURED",
        "Required model parameters are not configured; no value was substituted.",
        {"missing": exception.missing},
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "ccover-t-model-api",
        "equationVersion": EQUATION_VERSION,
        "modelVersion": MODEL_VERSION,
        "serviceTokenRequired": bool(_configured_service_token()),
        "demoProfileAllowed": _demo_profile_allowed(),
    }


@app.get("/ready")
def ready() -> dict[str, Any]:
    return {
        "status": "ready",
        "service": "ccover-t-model-api",
        "requiredParameters": list(REQUIRED_PARAMETER_KEYS),
        "unconfiguredParameters": sorted(key for key in REQUIRED_PARAMETER_KEYS if PAPER_PARAMETERS_BY_KEY[key].value is None),
        "equationsImplemented": True,
    }


@app.get("/model/metadata")
def model_metadata(request: Request, x_service_token: Optional[str] = Header(default=None)) -> Any:
    require_service_token(x_service_token)
    payload = metadata()
    payload["requestId"] = _request_id(request)
    payload["equationSource"] = EQUATION_SOURCE
    return payload


def _resolved_parameters(request: PredictRequest) -> tuple[ModelParameters, dict[str, Optional[float]], bool]:
    """Resolve an explicit profile and the narrow inactive-thermal exception."""

    values: dict[str, Optional[float]] = {key: request.parameters[key].value if key in request.parameters else None for key in REQUIRED_PARAMETER_KEYS}
    if request.profile == "demo":
        if not _demo_profile_allowed():
            raise ParametersNotConfiguredError(
                [
                    {
                        "key": "profile",
                        "reason": "the synthetic demo profile is disabled on this service",
                        "requiredBy": "development-only synthetic profile",
                        "note": "The demo profile is only available outside production with MODEL_ALLOW_DEMO_PROFILE=true.",
                    }
                ]
            )
        # A DEMO run is deliberately synthetic even when a paper configuration
        # happens to contain values for alpha or g.
        for key, synthetic in DEMO_SYNTHETIC_PARAMETERS.items():
            values[key] = synthetic

    alpha_not_required = False
    missing_other = [
        key for key in REQUIRED_PARAMETER_KEYS
        if key != "alpha" and values.get(key) is None
    ]
    if values.get("alpha") is None and not missing_other:
        candidate = ModelParameters.from_mapping({
            **values,
            "alpha": 0.0,
            "baselineYear": request.baseline_year,
            "tourismGrowthPeriods": [period.model_dump(by_alias=True) for period in request.tourism_growth_periods],
        })
        if thermal_term_inactive_for_horizon(candidate, request.horizon_years):
            # This zero is an explicit mathematical consequence of an inactive
            # max(0, T(t)-Tcrit) term, not a default alpha value.
            values["alpha"] = 0.0
            alpha_not_required = True

    return ModelParameters.from_mapping({
        **values,
        "baselineYear": request.baseline_year,
        "tourismGrowthPeriods": [period.model_dump(by_alias=True) for period in request.tourism_growth_periods],
    }), values, alpha_not_required


def _parameter_echo(
    request: PredictRequest,
    values: dict[str, Optional[float]],
    alpha_not_required: bool = False,
) -> list[ParameterEcho]:
    echo: list[ParameterEcho] = []
    for key in REQUIRED_PARAMETER_KEYS:
        supplied = request.parameters.get(key)
        fallback = PAPER_PARAMETERS_BY_KEY[key]
        if request.profile == "demo" and key in DEMO_SYNTHETIC_PARAMETERS:
            status = STATUS_SYNTHETIC_DEMO
            provenance = f"Synthetic development value from the {DEMO_PROFILE['id']} profile; not a research value."
            review_status = "synthetic"
            source_dataset_id = None
        elif key == "alpha" and alpha_not_required and (supplied is None or supplied.value is None):
            status = "not-required-for-horizon"
            provenance = (
                "Alpha was not numerically required for this horizon because the configured SST driver "
                "never exceeds Tcrit; the thermal term is exactly zero for this run."
            )
            review_status = "unreviewed"
            source_dataset_id = None
        elif supplied is not None:
            status = supplied.status
            provenance = supplied.provenance
            review_status = supplied.review_status
            source_dataset_id = supplied.source_dataset_id
        else:
            status = status_for(key, values.get(key))
            provenance = fallback.provenance
            review_status = fallback.review_status
            source_dataset_id = None
        echo.append(
            ParameterEcho(
                key=key,
                symbol=fallback.symbol,
                value=values.get(key),
                unit=supplied.unit if supplied is not None else fallback.unit,
                status=status,
                provenance=provenance,
                review_status=review_status,
                source_dataset_id=source_dataset_id,
                effective_date=supplied.effective_date if supplied is not None else fallback.effective_date,
            )
        )
    return echo


@app.post("/model/predict")
def predict(
    body: PredictRequest,
    request: Request,
    x_service_token: Optional[str] = Header(default=None),
) -> Any:
    require_service_token(x_service_token)
    parameters, values, alpha_not_required = _resolved_parameters(body)
    solver = SolverSettings(
        method=body.solver.method,
        substeps_per_year=body.solver.substeps_per_year,
        interval_mean_quadrature=body.solver.interval_mean_quadrature,
        state_output=body.solver.state_output,
        notes=str(SOLVER_NOTES),
    )
    bands = [
        {
            "label": band.label,
            "minPercent": band.min_percent,
            "maxPercent": band.max_percent,
            "upperInclusive": band.upper_inclusive,
        }
        for band in body.condition_bands
    ]
    result = simulate(
        parameters,
        initial_cover_percent=body.coral_baseline.cover_percent,
        horizon_years=body.horizon_years,
        solver=solver,
        condition_bands=bands,
    )
    warnings = list(result.warnings)
    warnings.append(str(SOLVER_NOTES))
    if body.coral_baseline.hard_coral_percent is not None and body.coral_baseline.soft_coral_percent is not None:
        if not body.coral_baseline.same_scope_confirmed:
            warnings.append(
                "Hard coral and soft coral were summed without a confirmed shared survey scope and basis; treat LCC with caution."
            )
        else:
            warnings.append(
                "Live coral cover was computed as LCC = hard coral + soft coral from a survey that defines both on the same scope and basis."
            )
    if body.consented_location is not None:
        warnings.append(
            "A consented browser location was recorded for context only. The published model is a citywide annual model and is not a per-site forecast."
        )
    if not body.sources:
        warnings.append("No source metadata was supplied with this run; the parameter provenance is all that is recorded.")
    if body.profile == "demo":
        warnings.append(demo_profile_warning())
    if body.profile == "paper-reproduction":
        warnings.extend([
            PAPER_REPRODUCTION_LABEL,
            "Paper-reproduction uses alpha = 0.05 per degree Celsius per year and the configured piecewise tourism growth periods.",
            "C0 = 57% in 2006 is the selected paper-reproduction baseline; the paper also reports conflicting values of 57.25% and 45.83%.",
            "K and beta are provisional/inferred and this result is not independently validated or 100% accurate.",
        ])
    if alpha_not_required:
        warnings.append(
            "Alpha was not numerically required for this horizon: sea-surface temperature never exceeds Tcrit, "
            "so the thermal term is exactly zero for this run."
        )
    if body.profile == "scenario":
        assumed = sorted(
            key
            for key in REQUIRED_PARAMETER_KEYS
            if body.parameters.get(key) is not None
            and body.parameters[key].status == "assumed"
        )
        warnings.append(
            "Exploratory scenario run, not a validated prediction: the caller supplied assumed values for "
            + (", ".join(assumed) if assumed else "one or more unconfigured parameters")
            + ". These results must not be cited as findings."
        )
    echoed_parameters = _parameter_echo(body, values, alpha_not_required)
    unreviewed = [item.key for item in echoed_parameters if item.review_status == "unreviewed"]
    if unreviewed:
        warnings.append(
            f"Parameters awaiting researcher review: {', '.join(unreviewed)}. Unreviewed parameters must not be presented as verified."
        )

    response = PredictResponse(
        equation_version=result.equation_version,
        model_version=result.model_version,
        model_config_version=body.model_config_version,
        request_id=body.request_id or _request_id(request),
        profile=body.profile,
        is_demo=body.profile == "demo",
        is_scenario=body.profile == "scenario",
        is_paper_reproduction=body.profile == "paper-reproduction",
        alpha_resolution="inactive-for-horizon" if alpha_not_required else "explicit",
        target_measure=body.coral_baseline.measure,
        study_area_id=body.study_area_id,
        study_area_label=body.study_area_label,
        scope=body.scope,
        baseline_year=body.baseline_year,
        horizon_years=body.horizon_years,
        forecast_end_year=body.forecast_end_year or body.baseline_year + body.horizon_years,
        initial_cover_percent=result.initial_cover_percent,
        final_cover_percent=result.final_cover_percent,
        final_interval_mean_percent=result.final_interval_mean_percent,
        state_classification=result.state_classification,
        mean_classification=result.mean_classification,
        classification_convention=result.classification_convention,
        classification_convention_source=str(CONDITION_CONVENTION["source"]),
        annual=[AnnualOutput(**item.to_dict()) for item in result.annual],
        parameters=echoed_parameters,
        solver=SolverEcho(
            method=result.solver.method,
            substeps_per_year=result.solver.substeps_per_year,
            interval_mean_quadrature=result.solver.interval_mean_quadrature,
            state_output=result.solver.state_output,
            notes=result.solver.notes,
        ),
        sources=body.sources,
        warnings=list(dict.fromkeys(warnings)),
        conditions=body.condition_bands,
        missing_parameters=[],
        tourism_growth_periods=body.tourism_growth_periods,
    )
    return response


@app.post("/model/validate")
def validate_run(
    body: ValidationRequest,
    request: Request,
    x_service_token: Optional[str] = Header(default=None),
) -> Any:
    """
    Independent time-based evaluation and exploratory fitting.

    Returns holdout metrics against three baselines, rolling-origin metrics
    restricted to training years, bounded nonlinear least-squares fits for alpha
    and beta, and bootstrap 95% intervals. It never marks anything validated.
    """

    require_service_token(x_service_token)
    values: dict[str, Optional[float]] = {
        key: body.parameters[key].value if key in body.parameters else None for key in REQUIRED_PARAMETER_KEYS
    }
    missing = sorted(key for key, value in values.items() if value is None)
    if missing:
        raise ParametersNotConfiguredError(
            [
                {
                    "key": key,
                    "reason": "Independent evaluation needs an explicit starting value; the service will not fit a missing parameter.",
                }
                for key in missing
            ]
        )
    parameters = ModelParameters.from_mapping({**values, "baselineYear": body.baseline_year})
    # The fit is restricted to training years. Later observations are held back
    # for the holdout metrics so they can never influence a fitted value.
    training_cover = [point for point in body.coral_cover.points if point[0] <= body.train_end_year]
    training_tourism = [point for point in body.tourism.points if point[0] <= body.train_end_year]
    fit = fit_alpha_beta_g(
        parameters,
        training_cover,
        training_tourism,
        body.train_end_year,
        body.training_dataset_version,
        bootstrap_samples=body.bootstrap_samples,
        seed=body.seed,
    )
    holdout = evaluate_time_split(
        parameters,
        body.coral_cover.points,
        body.train_end_year,
        body.validation_dataset_version,
    )
    return {
        "equationVersion": EQUATION_VERSION,
        "modelVersion": MODEL_VERSION,
        "requestId": body.request_id or _request_id(request),
        "studyAreaId": body.study_area_id,
        "fitting": fit,
        "holdout": holdout,
        "dataProvenance": {
            "coralCover": {"label": body.coral_cover.label, "yearCount": len(body.coral_cover.points)},
            "tourism": {"label": body.tourism.label, "yearCount": len(body.tourism.points)},
            "trainingDatasetVersion": body.training_dataset_version,
            "validationDatasetVersion": body.validation_dataset_version,
        },
        "status": "metrics and exploratory fits only; nothing is marked validated or reviewed",
        "warnings": [
            "Fitted alpha, beta, and g are not paper values. Adopting one requires a new reviewed model configuration version.",
            "Bootstrap intervals describe fit sampling variation, not structural model uncertainty; fixed inputs such as K retain their own uncertainty.",
            "A holdout metric is not evidence of predictive validity until the validation series is independent and documented.",
        ],
    }


@app.post("/model/calibrate")
def calibrate(
    body: CalibrateRequest,
    request: Request,
    x_service_token: Optional[str] = Header(default=None),
) -> Any:
    """Invert the published equation for one parameter against an observation."""

    require_service_token(x_service_token)
    values: dict[str, Optional[float]] = {
        key: body.parameters[key].value if key in body.parameters else None for key in REQUIRED_PARAMETER_KEYS
    }
    if values[body.parameter_key] is None:
        raise ModelValidationError(
            body.parameter_key,
            "must have a starting value: a fit is relative to the other configured parameters, not an absolute one",
        )
    parameters = ModelParameters.from_mapping({**values, "baselineYear": body.baseline_year})
    solver = SolverSettings(
        method=body.solver.method,
        substeps_per_year=body.solver.substeps_per_year,
        interval_mean_quadrature=body.solver.interval_mean_quadrature,
        state_output=body.solver.state_output,
        notes=str(SOLVER_NOTES),
    )
    bands = [
        {
            "label": band.label,
            "minPercent": band.min_percent,
            "maxPercent": band.max_percent,
            "upperInclusive": band.upper_inclusive,
        }
        for band in body.condition_bands
    ]
    fitted = calibrate_parameter(
        parameters,
        key=body.parameter_key,
        initial_cover_percent=body.initial_cover_percent,
        observed_cover_percent=body.observed_cover_percent,
        observed_cover_year=body.observed_cover_year,
        solver=solver,
        condition_bands=bands,
    )
    return CalibrateResponse(
        equation_version=EQUATION_VERSION,
        model_version=MODEL_VERSION,
        request_id=body.request_id or _request_id(request),
        parameter_key=fitted["parameterKey"],
        value=fitted["value"],
        search_bracket=fitted["searchBracket"],
        observed_cover_percent=fitted["observedCoverPercent"],
        observed_cover_year=fitted["observedCoverYear"],
        fitted_final_cover_percent=fitted["fittedFinalCoverPercent"],
        absolute_residual_percent=fitted["absoluteResidualPercent"],
        method=fitted["method"],
        note=fitted["note"],
        warnings=fitted["warnings"],
    )
