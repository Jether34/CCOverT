"""Request and response schemas for the internal CCOverT model service.

The service is not a public API: the Express API is the only caller. These
schemas are the typed contract between the two services, and they are exchanged
as camelCase JSON.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from .parameters import PROVISIONAL_CONDITION_BANDS, SOLVER_DEFAULTS, STUDY_AREA

#: ``scenario`` is an exploratory run whose unconfigured parameters the caller
#: supplies explicitly. It is never a validated profile: the response is flagged
#: so downstream consumers can keep it out of validated results.
ProfileLiteral = Literal["paper", "demo", "scenario", "paper-reproduction"]


class ApiModel(BaseModel):
    """Base model: camelCase JSON in both directions, no unknown fields."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, alias_generator=to_camel)


class SourceMetadata(ApiModel):
    """Provenance of one input or parameter used for a run."""

    name: str = Field(min_length=1, max_length=120)
    source: str = Field(min_length=1, max_length=400)
    unit: str = Field(min_length=1, max_length=80)
    time_window: str = Field(min_length=1, max_length=200)
    coverage: Optional[str] = Field(default=None, max_length=200)
    scope: Optional[str] = Field(default=None, max_length=120)
    dataset_id: Optional[str] = Field(default=None, max_length=120)
    retrieved_at: Optional[str] = Field(default=None, max_length=64)


class ParameterValue(ApiModel):
    """A parameter supplied by the caller together with its provenance."""

    value: Optional[float] = None
    unit: str = Field(min_length=1, max_length=120)
    status: str = Field(min_length=1, max_length=60)
    provenance: str = Field(min_length=1, max_length=600)
    source_dataset_id: Optional[str] = Field(default=None, max_length=120)
    review_status: str = Field(default="unreviewed", max_length=60)
    effective_date: Optional[str] = Field(default=None, max_length=40)

    @field_validator("value")
    @classmethod
    def _finite_or_none(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("parameter value must be a finite number")
        return value


class SolverRequest(ApiModel):
    method: str = Field(default=str(SOLVER_DEFAULTS["method"]), min_length=1, max_length=20)
    substeps_per_year: int = Field(default=int(SOLVER_DEFAULTS["substepsPerYear"]), ge=1, le=365)
    interval_mean_quadrature: str = Field(
        default=str(SOLVER_DEFAULTS["intervalMeanQuadrature"]), min_length=1, max_length=40
    )
    state_output: str = Field(default=str(SOLVER_DEFAULTS["stateOutput"]), min_length=1, max_length=40)

    @field_validator("method")
    @classmethod
    def _supported(cls, value: str) -> str:
        if value != "rk4":
            raise ValueError("only the rk4 solver is implemented")
        return value

    @field_validator("interval_mean_quadrature")
    @classmethod
    def _quadrature(cls, value: str) -> str:
        if value != "trapezoid":
            raise ValueError("only trapezoid interval-mean quadrature is implemented")
        return value


class ConditionBand(ApiModel):
    label: str = Field(min_length=1, max_length=60)
    min_percent: float = Field(ge=0, le=100)
    max_percent: float = Field(gt=0, le=100)
    upper_inclusive: bool = False


class CoralBaseline(ApiModel):
    """The dated live-coral-cover baseline the run starts from."""

    cover_percent: float = Field(ge=0, le=100)
    year: int = Field(ge=1900, le=2100)
    hard_coral_percent: Optional[float] = Field(default=None, ge=0, le=100)
    soft_coral_percent: Optional[float] = Field(default=None, ge=0, le=100)
    measure: str = Field(default="%LCC (HC+SC)", max_length=60)
    survey_source: str = Field(min_length=1, max_length=400)
    survey_scope: str = Field(default="citywide-annual-average", max_length=120)
    same_scope_confirmed: bool = True

    @field_validator("survey_source")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("a dated survey source is required for the coral-cover baseline")
        if not any(str(year) in value for year in range(1800, 2201)):
            raise ValueError("the coral-cover baseline source must include a year")
        return value.strip()


class TourismGrowthPeriod(ApiModel):
    start_year: int = Field(ge=1900, le=9999)
    end_year: int = Field(ge=1900, le=9999)
    growth_rate: float = Field(ge=-0.5, le=0.5)
    unit: str = Field(min_length=1, max_length=80)
    provenance: str = Field(min_length=1, max_length=600)
    review_status: str = Field(default="unreviewed", min_length=1, max_length=60)
    effective_date: Optional[str] = Field(default=None, max_length=40)

    @field_validator("end_year")
    @classmethod
    def _valid_range(cls, value: int, info: Any) -> int:
        start = info.data.get("start_year")
        if start is not None and value < start:
            raise ValueError("endYear must not be before startYear")
        return value


class PredictRequest(ApiModel):
    """A complete, sourced run request for the published equation."""

    study_area_id: str = Field(default=STUDY_AREA["id"], min_length=1, max_length=80)
    study_area_label: str = Field(default=STUDY_AREA["label"], min_length=1, max_length=200)
    scope: str = Field(default=str(STUDY_AREA["scope"]), min_length=1, max_length=80)
    consented_location: Optional[dict[str, Any]] = None
    profile: ProfileLiteral = "paper"
    baseline_year: int = Field(ge=1900, le=2100)
    horizon_years: int = Field(ge=1, le=100)
    forecast_end_year: Optional[int] = Field(default=None, ge=1901, le=2200)
    coral_baseline: CoralBaseline
    parameters: dict[str, ParameterValue]
    solver: SolverRequest = Field(default_factory=SolverRequest)
    condition_bands: list[ConditionBand] = Field(
        default_factory=lambda: [ConditionBand(**band) for band in PROVISIONAL_CONDITION_BANDS]
    )
    sources: list[SourceMetadata] = Field(default_factory=list, max_length=50)
    model_config_version: str = Field(min_length=1, max_length=120)
    request_id: Optional[str] = Field(default=None, max_length=120)
    tourism_growth_periods: list[TourismGrowthPeriod] = Field(default_factory=list, max_length=20)

    @field_validator("parameters")
    @classmethod
    def _non_empty(cls, value: dict[str, ParameterValue]) -> dict[str, ParameterValue]:
        if not value:
            raise ValueError("at least one model parameter must be supplied")
        return value

    @model_validator(mode="after")
    def _forecast_window_matches_duration(self) -> "PredictRequest":
        if self.forecast_end_year is not None and self.forecast_end_year != self.baseline_year + self.horizon_years:
            raise ValueError("forecastEndYear must equal baselineYear + horizonYears")
        return self


class AnnualOutput(ApiModel):
    year: int
    t_years: float
    cover_start_percent: float
    cover_end_percent: float
    cover_interval_mean_percent: float
    temperature_start_c: float
    temperature_end_c: float
    tourism_start_arrivals: float
    tourism_end_arrivals: float
    tourism_growth_rate: float
    tourism_period_start_year: Optional[int] = None
    tourism_period_end_year: Optional[int] = None
    growth_rate_mean: float
    thermal_rate_mean: float
    tourism_rate_mean: float
    growth_contribution_pp: float
    thermal_contribution_pp: float
    tourism_contribution_pp: float
    state_classification: Optional[str] = None
    mean_classification: Optional[str] = None


class ParameterEcho(ApiModel):
    key: str
    symbol: str
    value: Optional[float]
    unit: str
    status: str
    provenance: str
    review_status: str
    source_dataset_id: Optional[str] = None
    effective_date: Optional[str] = None


class SolverEcho(ApiModel):
    method: str
    substeps_per_year: int
    interval_mean_quadrature: str
    state_output: str
    notes: str


class PredictResponse(ApiModel):
    """Versioned annual output plus every input needed to reproduce it."""

    equation_version: str
    model_version: str
    model_config_version: str
    request_id: str
    profile: str
    is_demo: bool
    #: True when the caller substituted assumed values for unconfigured
    #: parameters. Such a run is exploratory, not a validated prediction.
    is_scenario: bool
    is_paper_reproduction: bool = False
    alpha_resolution: str = "explicit"
    target_measure: str
    study_area_id: str
    study_area_label: str
    scope: str
    baseline_year: int
    horizon_years: int
    forecast_end_year: Optional[int] = None
    initial_cover_percent: float
    final_cover_percent: float
    final_interval_mean_percent: float
    state_classification: Optional[str] = None
    mean_classification: Optional[str] = None
    classification_convention: str
    classification_convention_source: str
    annual: list[AnnualOutput]
    parameters: list[ParameterEcho]
    solver: SolverEcho
    sources: list[SourceMetadata]
    warnings: list[str]
    conditions: list[ConditionBand]
    missing_parameters: list[dict[str, Any]] = Field(default_factory=list)
    tourism_growth_periods: list[TourismGrowthPeriod] = Field(default_factory=list)


class CalibrateRequest(ApiModel):
    """Fit a single parameter so the published equation reproduces an observation."""

    study_area_id: str = Field(default=STUDY_AREA["id"], min_length=1, max_length=80)
    baseline_year: int = Field(ge=1900, le=2100)
    parameter_key: str = Field(min_length=1, max_length=40)
    initial_cover_percent: float = Field(ge=0, le=100)
    observed_cover_percent: float = Field(ge=0, le=100)
    observed_cover_year: int = Field(ge=1900, le=2100)
    parameters: dict[str, ParameterValue]
    solver: SolverRequest = Field(default_factory=SolverRequest)
    condition_bands: list[ConditionBand] = Field(
        default_factory=lambda: [ConditionBand.model_validate(band) for band in PROVISIONAL_CONDITION_BANDS]
    )
    request_id: Optional[str] = Field(default=None, max_length=120)


class ObservationSeries(ApiModel):
    """Annual (year, value) observations supplied by the researcher."""

    label: str = Field(min_length=1, max_length=200)
    points: list[tuple[int, float]] = Field(min_length=2)


class ValidationRequest(ApiModel):
    """
    Research-only independent evaluation. Nothing here promotes a configuration
    to reviewed or validated; it produces metrics and fitted values that a
    researcher must still adopt through a new model configuration version.
    """

    study_area_id: str = Field(default=STUDY_AREA["id"], min_length=1, max_length=80)
    baseline_year: int = Field(ge=1900, le=2100)
    parameters: dict[str, ParameterValue]
    coral_cover: ObservationSeries
    tourism: ObservationSeries
    train_end_year: int = Field(ge=1900, le=2100)
    training_dataset_version: str = Field(min_length=1, max_length=200)
    validation_dataset_version: str = Field(min_length=1, max_length=200)
    bootstrap_samples: int = Field(default=20, ge=3, le=200)
    seed: int = Field(default=1, ge=0, le=2**31 - 1)
    request_id: Optional[str] = Field(default=None, max_length=120)


class CalibrateResponse(ApiModel):
    equation_version: str
    model_version: str
    request_id: str
    parameter_key: str
    value: float
    search_bracket: list[float]
    observed_cover_percent: float
    observed_cover_year: int
    fitted_final_cover_percent: float
    absolute_residual_percent: float
    method: str
    note: str
    warnings: list[str]


class ErrorResponse(ApiModel):
    error: dict[str, Any]
