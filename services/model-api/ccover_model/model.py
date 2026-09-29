"""The CCOverT coral-cover model.

The published equations are implemented exactly as written in the research paper:

    dC/dt = r*C*(1 - C/K) - alpha*max(0, T(t) - Tcrit)*C - beta*V(t)*C
    T(t)  = T0 + gamma*t
    V(t)  = V0*exp(g*t)

with C as live coral cover in percentage points on a 0-100 scale and t as
elapsed years from the configured baseline year. The paper does not identify a
numerical solver or define within-year averaging, so this module uses classical
fourth-order Runge-Kutta with a fixed number of substeps per year and reports
both the end-of-year state and the trapezoidal interval mean of every quantity.
The solver settings are returned with the result and are stored with each saved
prediction.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional, Sequence

from .parameters import (
    EQUATION_VERSION,
    EQUATIONS,
    MODEL_VERSION,
    PROVISIONAL_CONDITION_BANDS,
    REQUIRED_PARAMETER_KEYS,
    STATUS_PROVISIONAL,
    STATUS_SYNTHETIC_DEMO,
)

#: Physical bounds for live coral cover, in percentage points.
MIN_COVER_PERCENT = 0.0
MAX_COVER_PERCENT = 100.0

#: Absolute tolerance used when detecting a state that left the physical range.
COVER_TOLERANCE = 1e-9

_SUPPORTED_SOLVER_METHODS = ("rk4",)


@dataclass(frozen=True)
class _ParameterField:
    """Binds a paper parameter symbol to its Python field name."""

    symbol: str
    field: str
    unit: str


#: The nine parameters the published equation cannot be evaluated without.
PARAMETER_FIELDS: tuple[_ParameterField, ...] = (
    _ParameterField("r", "r", "per year"),
    _ParameterField("alpha", "alpha", "per degree Celsius per year"),
    _ParameterField("beta", "beta", "per tourist arrival per year (inferred; units unclear in the paper)"),
    _ParameterField("gamma", "gamma", "degrees Celsius per year"),
    _ParameterField("T0", "t0", "degrees Celsius"),
    _ParameterField("Tcrit", "tcrit", "degrees Celsius"),
    _ParameterField("V0", "v0", "tourist arrivals per year"),
    _ParameterField("g", "g", "per year"),
    _ParameterField("K", "k", "coral-cover percentage points"),
)

REQUIRED_PARAMETER_SPECS: tuple[_ParameterField, ...] = PARAMETER_FIELDS


class ModelValidationError(ValueError):
    """A request value is outside the range the model can accept."""

    def __init__(self, field_name: str, reason: str) -> None:
        super().__init__(f"{field_name}: {reason}")
        self.field = field_name
        self.reason = reason

    def to_dict(self) -> dict[str, Any]:
        return {"field": self.field, "reason": self.reason}


class ParametersNotConfiguredError(ValueError):
    """A parameter required by the published equation has no configured value."""

    def __init__(self, missing: Sequence[Mapping[str, Any]]) -> None:
        super().__init__("Required model parameters are not configured.")
        self.missing = [dict(item) for item in missing]

    def to_dict(self) -> dict[str, Any]:
        return {"missing": [dict(item) for item in self.missing]}


@dataclass(frozen=True)
class SolverSettings:
    method: str = "rk4"
    substeps_per_year: int = 12
    interval_mean_quadrature: str = "trapezoid"
    state_output: str = "end-of-year"
    notes: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "SolverSettings":
        if value is None:
            return cls()
        method = str(value.get("method", "rk4"))
        if method not in _SUPPORTED_SOLVER_METHODS:
            raise ModelValidationError("solver.method", f"unsupported solver '{method}'")
        substeps = value.get("substepsPerYear", value.get("substeps_per_year", 12))
        if not isinstance(substeps, int) or isinstance(substeps, bool) or substeps < 1 or substeps > 365:
            raise ModelValidationError("solver.substepsPerYear", "must be an integer between 1 and 365")
        quadrature = str(value.get("intervalMeanQuadrature", "trapezoid"))
        if quadrature != "trapezoid":
            raise ModelValidationError("solver.intervalMeanQuadrature", "only 'trapezoid' quadrature is implemented")
        return cls(
            method=method,
            substeps_per_year=substeps,
            interval_mean_quadrature=quadrature,
            state_output=str(value.get("stateOutput", "end-of-year")),
            notes=str(value.get("notes", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "substepsPerYear": self.substeps_per_year,
            "intervalMeanQuadrature": self.interval_mean_quadrature,
            "stateOutput": self.state_output,
            "notes": self.notes,
        }


@dataclass(frozen=True)
class ModelParameters:
    """A complete, validated parameter set for the published equation."""

    r: float
    alpha: float
    beta: float
    gamma: float
    t0: float
    tcrit: float
    v0: float
    g: float
    k: float
    baseline_year: int = 2006
    tourism_growth_periods: tuple[dict[str, Any], ...] = ()

    # -- construction -----------------------------------------------------
    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ModelParameters":
        missing: list[dict[str, Any]] = []
        resolved: dict[str, Any] = {}
        for key in REQUIRED_PARAMETER_KEYS:
            if key not in value or value[key] is None:
                missing.append(
                    {
                        "key": key,
                        "reason": "not configured",
                        "requiredBy": "published CCOverT equation",
                        "note": "This value is not numerically specified in the paper and is never substituted with a default.",
                    }
                )
            else:
                resolved[key] = value[key]
        if missing:
            raise ParametersNotConfiguredError(missing)

        baseline_year = value.get("baselineYear", 2006)
        if not isinstance(baseline_year, int) or isinstance(baseline_year, bool) or not 1900 <= baseline_year <= 2100:
            raise ModelValidationError("baselineYear", "must be an integer year between 1900 and 2100")

        numbers: dict[str, float] = {}
        for key in REQUIRED_PARAMETER_KEYS:
            raw = resolved[key]
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise ModelValidationError(key, "must be a number")
            number = float(raw)
            if not math.isfinite(number):
                raise ModelValidationError(key, "must be a finite number")
            numbers[key] = number

        cls._check_ranges(numbers)
        fields = {spec.symbol.lower(): numbers[spec.symbol] for spec in REQUIRED_PARAMETER_SPECS}
        raw_periods = value.get("tourismGrowthPeriods", value.get("tourism_growth_periods", ()))
        periods = tuple(dict(period) for period in raw_periods) if raw_periods else ()
        cls._check_tourism_periods(periods, baseline_year)
        return cls(baseline_year=baseline_year, tourism_growth_periods=periods, **fields)

    @staticmethod
    def _check_tourism_periods(periods: tuple[dict[str, Any], ...], baseline_year: int) -> None:
        if not periods:
            return
        previous_end: int | None = None
        for index, period in enumerate(periods):
            try:
                start = int(period.get("startYear", period.get("start_year")))
                end = int(period.get("endYear", period.get("end_year")))
                growth = float(period.get("growthRate", period.get("growth_rate")))
            except (TypeError, ValueError):
                raise ModelValidationError("tourismGrowthPeriods", "each period needs numeric startYear, endYear and growthRate")
            if start > end:
                raise ModelValidationError("tourismGrowthPeriods", "period startYear must not exceed endYear")
            if not math.isfinite(growth) or not -0.5 <= growth <= 0.5:
                raise ModelValidationError("tourismGrowthPeriods.growthRate", "must be finite and between -0.5 and 0.5 per year")
            if index == 0 and start > baseline_year:
                raise ModelValidationError("tourismGrowthPeriods", "the first period must cover the configured baseline year")
            if previous_end is not None and start != previous_end + 1:
                raise ModelValidationError("tourismGrowthPeriods", "periods must be ordered, non-overlapping, and gap-free")
            previous_end = end

    @staticmethod
    def _check_ranges(values: Mapping[str, float]) -> None:
        if not 0.0 <= values["r"] <= 5.0:
            raise ModelValidationError("r", "must be between 0 and 5 per year")
        if values["alpha"] < 0.0:
            raise ModelValidationError("alpha", "must be zero or positive")
        if values["beta"] < 0.0:
            raise ModelValidationError("beta", "must be zero or positive")
        if not -0.5 <= values["gamma"] <= 0.5:
            raise ModelValidationError("gamma", "must be between -0.5 and 0.5 degrees Celsius per year")
        if not -5.0 <= values["T0"] <= 45.0:
            raise ModelValidationError("T0", "must be a plausible sea-surface temperature between -5 and 45 degrees Celsius")
        if not -5.0 <= values["Tcrit"] <= 45.0:
            raise ModelValidationError("Tcrit", "must be a plausible sea-surface temperature between -5 and 45 degrees Celsius")
        if values["V0"] < 0.0:
            raise ModelValidationError("V0", "must be zero or positive tourist arrivals per year")
        if not -0.5 <= values["g"] <= 0.5:
            raise ModelValidationError("g", "must be between -0.5 and 0.5 per year")
        if not 0.0 < values["K"] <= MAX_COVER_PERCENT:
            raise ModelValidationError("K", "must be greater than 0 and no more than 100 cover percentage points")

    # -- derived drivers --------------------------------------------------
    def temperature(self, t: float) -> float:
        """T(t) = T0 + gamma*t, in degrees Celsius (sea-surface temperature)."""

        return self.t0 + self.gamma * t

    def tourism(self, t: float) -> float:
        """V(t) = V0*exp(g*t), optionally integrated across growth periods."""

        if not self.tourism_growth_periods:
            return self.v0 * math.exp(self.g * t)
        if t < 0:
            raise ModelValidationError("t", "cannot be negative from the configured baseline")
        target_year = self.baseline_year + t
        value = self.v0
        cursor = self.baseline_year
        for period in self.tourism_growth_periods:
            start = int(period.get("startYear", period.get("start_year")))
            end = int(period.get("endYear", period.get("end_year"))) + 1
            growth = float(period.get("growthRate", period.get("growth_rate")))
            segment_start = max(cursor, start)
            segment_end = min(target_year, end)
            if segment_end > segment_start:
                value *= math.exp(growth * (segment_end - segment_start))
                cursor = segment_end
            if cursor >= target_year:
                break
        if cursor < target_year:
            raise ModelValidationError("tourismGrowthPeriods", "periods do not cover the requested horizon")
        return value

    def tourism_growth_rate(self, t: float) -> float:
        if not self.tourism_growth_periods:
            return self.g
        year = self.baseline_year + int(math.floor(t))
        for period in self.tourism_growth_periods:
            start = int(period.get("startYear", period.get("start_year")))
            end = int(period.get("endYear", period.get("end_year")))
            if start <= year <= end:
                return float(period.get("growthRate", period.get("growth_rate")))
        raise ModelValidationError("tourismGrowthPeriods", f"no tourism growth period covers year {year}")

    def components(self, cover: float, t: float) -> tuple[float, float, float]:
        """Return (growth, thermal, tourism) rates for a state and time."""

        growth = self.r * cover * (1.0 - cover / self.k)
        thermal = -self.alpha * max(0.0, self.temperature(t) - self.tcrit) * cover
        tourism = -self.beta * self.tourism(t) * cover
        return growth, thermal, tourism

    def derivative(self, cover: float, t: float) -> float:
        growth, thermal, tourism = self.components(cover, t)
        return growth + thermal + tourism

    def to_dict(self) -> dict[str, float]:
        return {
            "r": self.r,
            "alpha": self.alpha,
            "beta": self.beta,
            "gamma": self.gamma,
            "T0": self.t0,
            "Tcrit": self.tcrit,
            "V0": self.v0,
            "g": self.g,
            "K": self.k,
            "baselineYear": self.baseline_year,
            "tourismGrowthPeriods": [dict(period) for period in self.tourism_growth_periods],
        }


@dataclass(frozen=True)
class AnnualState:
    """One simulated year: end-of-year state, interval mean and components."""

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
    tourism_period_start_year: int | None
    tourism_period_end_year: int | None
    growth_rate_mean: float
    thermal_rate_mean: float
    tourism_rate_mean: float
    growth_contribution_pp: float
    thermal_contribution_pp: float
    tourism_contribution_pp: float
    state_classification: Optional[str]
    mean_classification: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "year": self.year,
            "tYears": round(self.t_years, 6),
            "coverStartPercent": round(self.cover_start_percent, 6),
            "coverEndPercent": round(self.cover_end_percent, 6),
            "coverIntervalMeanPercent": round(self.cover_interval_mean_percent, 6),
            "temperatureStartC": round(self.temperature_start_c, 6),
            "temperatureEndC": round(self.temperature_end_c, 6),
            "tourismStartArrivals": round(self.tourism_start_arrivals, 4),
            "tourismEndArrivals": round(self.tourism_end_arrivals, 4),
            "tourismGrowthRate": round(self.tourism_growth_rate, 6),
            "tourismPeriodStartYear": self.tourism_period_start_year,
            "tourismPeriodEndYear": self.tourism_period_end_year,
            "growthRateMean": round(self.growth_rate_mean, 6),
            "thermalRateMean": round(self.thermal_rate_mean, 6),
            "tourismRateMean": round(self.tourism_rate_mean, 6),
            "growthContributionPp": round(self.growth_contribution_pp, 6),
            "thermalContributionPp": round(self.thermal_contribution_pp, 6),
            "tourismContributionPp": round(self.tourism_contribution_pp, 6),
            "stateClassification": self.state_classification,
            "meanClassification": self.mean_classification,
        }


@dataclass(frozen=True)
class SimulationResult:
    initial_cover_percent: float
    final_cover_percent: float
    final_interval_mean_percent: float
    horizon_years: int
    annual: tuple[AnnualState, ...]
    state_classification: Optional[str]
    mean_classification: Optional[str]
    classification_convention: str
    warnings: tuple[str, ...]
    parameters: ModelParameters
    solver: SolverSettings
    equation_version: str = EQUATION_VERSION
    model_version: str = MODEL_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "equationVersion": self.equation_version,
            "modelVersion": self.model_version,
            "initialCoverPercent": round(self.initial_cover_percent, 6),
            "finalCoverPercent": round(self.final_cover_percent, 6),
            "finalIntervalMeanPercent": round(self.final_interval_mean_percent, 6),
            "horizonYears": self.horizon_years,
            "annual": [item.to_dict() for item in self.annual],
            "stateClassification": self.state_classification,
            "meanClassification": self.mean_classification,
            "classificationConvention": self.classification_convention,
            "parameters": self.parameters.to_dict(),
            "solver": self.solver.to_dict(),
            "warnings": list(self.warnings),
        }


# ---------------------------------------------------------------------------
# condition classification
# ---------------------------------------------------------------------------


def validate_condition_bands(bands: Iterable[Mapping[str, Any]]) -> tuple[dict[str, Any], ...]:
    """Validate that a condition convention is gap-free over 0-100 percent."""

    materialised = tuple(dict(band) for band in bands)
    if not materialised:
        raise ModelValidationError("conditionBands", "at least one band is required")
    previous_max: Optional[float] = None
    for band in materialised:
        label = band.get("label")
        minimum = band.get("minPercent")
        maximum = band.get("maxPercent")
        upper_inclusive = bool(band.get("upperInclusive", False))
        if not isinstance(label, str) or not label.strip():
            raise ModelValidationError("conditionBands", "every band needs a non-empty label")
        for name, number in (("minPercent", minimum), ("maxPercent", maximum)):
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(float(number)):
                raise ModelValidationError("conditionBands", f"band '{label}' has a non-finite {name}")
        minimum = float(minimum)
        maximum = float(maximum)
        if minimum < 0.0 or maximum > 100.0 or maximum <= minimum:
            raise ModelValidationError("conditionBands", f"band '{label}' must satisfy 0 <= minPercent < maxPercent <= 100")
        if previous_max is not None and not math.isclose(minimum, previous_max):
            raise ModelValidationError("conditionBands", f"band '{label}' leaves a gap or overlap at {minimum} percent")
        previous_max = maximum
        if upper_inclusive and not math.isclose(maximum, 100.0):
            raise ModelValidationError("conditionBands", "only the final band may be inclusive at 100 percent")
    first = materialised[0]
    if not math.isclose(float(first["minPercent"]), 0.0):
        raise ModelValidationError("conditionBands", "the first band must start at 0 percent")
    if not bool(materialised[-1].get("upperInclusive", False)) or not math.isclose(float(materialised[-1]["maxPercent"]), 100.0):
        raise ModelValidationError("conditionBands", "the last band must end inclusively at 100 percent")
    return materialised


def classify_percent(percent: float, bands: Sequence[Mapping[str, Any]]) -> Optional[str]:
    """Return the label of the band containing ``percent``."""

    value = float(percent)
    if not math.isfinite(value):
        raise ModelValidationError("coverPercent", "must be a finite number")
    for band in bands:
        minimum = float(band["minPercent"])
        maximum = float(band["maxPercent"])
        if value >= minimum and (value <= maximum if bool(band.get("upperInclusive", False)) else value < maximum):
            return str(band["label"])
    return None


# ---------------------------------------------------------------------------
# simulation
# ---------------------------------------------------------------------------


def _trapezoid_mean(values: list[float], step: float) -> float:
    """Trapezoidal mean of a uniformly sampled quantity over one interval."""

    total = (values[0] + values[-1]) / 2.0
    for index in range(1, len(values) - 1):
        total += values[index]
    return total * step


def simulate(
    parameters: ModelParameters,
    initial_cover_percent: float,
    horizon_years: int,
    solver: SolverSettings | None = None,
    condition_bands: Iterable[Mapping[str, Any]] | None = None,
) -> SimulationResult:
    """Integrate the CCOverT equation and return annual states and interval means."""

    settings = solver or SolverSettings()
    bands = validate_condition_bands(condition_bands if condition_bands is not None else PROVISIONAL_CONDITION_BANDS)

    cover_initial = float(initial_cover_percent)
    if not math.isfinite(cover_initial):
        raise ModelValidationError("initialCoverPercent", "must be a finite number")
    if not MIN_COVER_PERCENT <= cover_initial <= MAX_COVER_PERCENT:
        raise ModelValidationError(
            "initialCoverPercent",
            f"must be between {MIN_COVER_PERCENT} and {MAX_COVER_PERCENT} cover percentage points",
        )
    if isinstance(horizon_years, bool) or not isinstance(horizon_years, int) or horizon_years < 1 or horizon_years > 100:
        raise ModelValidationError("horizonYears", "must be an integer between 1 and 100")

    warnings: list[str] = []
    clamped_low = False
    clamped_high = False

    h = 1.0 / settings.substeps_per_year
    cover = cover_initial
    annual: list[AnnualState] = []

    for year_index in range(horizon_years):
        t_start = float(year_index)
        t_end = float(year_index + 1)
        cover_start = cover

        node_times = [t_start + index * h for index in range(settings.substeps_per_year + 1)]
        growth_nodes: list[float] = []
        thermal_nodes: list[float] = []
        tourism_nodes: list[float] = []
        cover_nodes: list[float] = [cover_start]

        for step_index in range(settings.substeps_per_year):
            t = node_times[step_index]
            growth, thermal, tourism = parameters.components(cover, t)
            if step_index == 0:
                growth_nodes.append(growth)
                thermal_nodes.append(thermal)
                tourism_nodes.append(tourism)
            k1 = growth + thermal + tourism
            growth2, thermal2, tourism2 = parameters.components(cover + 0.5 * h * k1, t + 0.5 * h)
            k2 = growth2 + thermal2 + tourism2
            growth3, thermal3, tourism3 = parameters.components(cover + 0.5 * h * k2, t + 0.5 * h)
            k3 = growth3 + thermal3 + tourism3
            growth4, thermal4, tourism4 = parameters.components(cover + h * k3, t + h)
            k4 = growth4 + thermal4 + tourism4
            cover = cover + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
            if not math.isfinite(cover):
                raise ModelValidationError(
                    "integration",
                    "the numerical solution became non-finite; check the parameter magnitudes",
                )
            if cover < MIN_COVER_PERCENT - COVER_TOLERANCE:
                cover = MIN_COVER_PERCENT
                clamped_low = True
            elif cover > MAX_COVER_PERCENT + COVER_TOLERANCE:
                cover = MAX_COVER_PERCENT
                clamped_high = True
            cover_nodes.append(cover)
            growth_nodes.append(growth4)
            thermal_nodes.append(thermal4)
            tourism_nodes.append(tourism4)

        cover_mean = _trapezoid_mean(cover_nodes, h)
        growth_mean = _trapezoid_mean(growth_nodes, h)
        thermal_mean = _trapezoid_mean(thermal_nodes, h)
        tourism_mean = _trapezoid_mean(tourism_nodes, h)
        period_start_year = period_end_year = None
        if parameters.tourism_growth_periods:
            period_year = parameters.baseline_year + year_index + 1
            for period in parameters.tourism_growth_periods:
                start = int(period.get("startYear", period.get("start_year")))
                end = int(period.get("endYear", period.get("end_year")))
                if start <= period_year <= end:
                    period_start_year, period_end_year = start, end
                    break
        annual.append(
            AnnualState(
                year=parameters.baseline_year + year_index + 1,
                t_years=t_end,
                cover_start_percent=cover_start,
                cover_end_percent=cover,
                cover_interval_mean_percent=cover_mean,
                temperature_start_c=parameters.temperature(t_start),
                temperature_end_c=parameters.temperature(t_end),
                tourism_start_arrivals=parameters.tourism(t_start),
                tourism_end_arrivals=parameters.tourism(t_end),
                tourism_growth_rate=parameters.tourism_growth_rate(t_start),
                tourism_period_start_year=period_start_year,
                tourism_period_end_year=period_end_year,
                growth_rate_mean=growth_mean,
                thermal_rate_mean=thermal_mean,
                tourism_rate_mean=tourism_mean,
                # The interval is exactly one year long, so the trapezoidal
                # integral equals the mean rate and is additive with the change
                # in cover over the year.
                growth_contribution_pp=growth_mean,
                thermal_contribution_pp=thermal_mean,
                tourism_contribution_pp=tourism_mean,
                state_classification=classify_percent(cover, bands),
                mean_classification=classify_percent(cover_mean, bands),
            )
        )

    if clamped_low:
        warnings.append(
            "The simulated live coral cover reached 0 percentage points and was held at the physical lower bound for the remainder of the horizon."
        )
    if clamped_high:
        warnings.append(
            "The simulated live coral cover reached 100 percentage points and was held at the physical upper bound for the remainder of the horizon."
        )
    if parameters.k > MAX_COVER_PERCENT:
        warnings.append(
            f"K = {parameters.k} exceeds the 0-100 cover scale, so C and K are not on the same documented scale."
        )
    activation = thermal_activation_year(parameters)
    if activation is not None and activation > parameters.baseline_year + horizon_years:
        warnings.append(
            "With the configured baseline year, T0, gamma and Tcrit, sea-surface temperature only reaches Tcrit "
            f"around year {math.floor(activation)}, so the thermal term alpha*max(0, T(t) - Tcrit)*C is inactive "
            "across this whole horizon and alpha does not affect these results."
        )
    warnings.extend(parameter_warnings(parameters))

    final_cover = annual[-1].cover_end_percent
    final_mean = annual[-1].cover_interval_mean_percent
    return SimulationResult(
        initial_cover_percent=cover_initial,
        final_cover_percent=final_cover,
        final_interval_mean_percent=final_mean,
        horizon_years=horizon_years,
        annual=tuple(annual),
        state_classification=classify_percent(final_cover, bands),
        mean_classification=classify_percent(final_mean, bands),
        classification_convention=CONDITION_CONVENTION_ID,
        warnings=tuple(dict.fromkeys(warnings)),
        parameters=parameters,
        solver=settings,
    )


CONDITION_CONVENTION_ID = "provisional-gap-free-v1"


# Search ranges used only to bracket a data fit. They stay inside the ranges the
# model itself accepts, and the API records the bracket so a reader can see that
# the search was bounded rather than open-ended.
CALIBRATION_BRACKETS: dict[str, tuple[float, float]] = {
    "alpha": (0.0, 1.0),
    "beta": (0.0, 1e-3),
    "g": (0.0, 0.5),
    "r": (0.0, 5.0),
    "K": (1.0, MAX_COVER_PERCENT),
    "gamma": (-0.5, 0.5),
    "t0": (-5.0, 45.0),
    "tcrit": (-5.0, 45.0),
    "v0": (0.0, 1e7),
}


def _replace_parameter(parameters: ModelParameters, key: str, value: float) -> ModelParameters:
    """Rebuild a parameter set with one value replaced, preserving everything else."""

    from .parameters import PAPER_PARAMETER_SPECS

    mapping = parameters.to_dict()
    if key not in mapping:
        raise ModelValidationError(key, "is not a CCOverT parameter")
    mapping[key] = float(value)
    ordered = {spec.key: mapping.get(spec.key) for spec in PAPER_PARAMETER_SPECS}
    return ModelParameters.from_mapping(ordered)


def calibrate_parameter(
    parameters: ModelParameters,
    key: str,
    initial_cover_percent: float,
    observed_cover_percent: float,
    observed_cover_year: int,
    solver: SolverSettings | None = None,
    condition_bands: Iterable[Mapping[str, Any]] | None = None,
    max_iterations: int = 200,
) -> dict[str, Any]:
    """Fit one parameter so the simulation reproduces an observed cover value.

    This inverts the published equation. The numeric work stays in this module so
    that the TypeScript API never holds a second implementation of CCOverT.
    """

    if key not in CALIBRATION_BRACKETS:
        raise ModelValidationError(key, "cannot be calibrated")
    if not MIN_COVER_PERCENT <= observed_cover_percent <= MAX_COVER_PERCENT:
        raise ModelValidationError(
            "observedCoverPercent",
            f"must be between {MIN_COVER_PERCENT} and {MAX_COVER_PERCENT} cover percentage points",
        )
    if not MIN_COVER_PERCENT <= initial_cover_percent <= MAX_COVER_PERCENT:
        raise ModelValidationError(
            "initialCoverPercent",
            f"must be between {MIN_COVER_PERCENT} and {MAX_COVER_PERCENT} cover percentage points",
        )
    horizon = observed_cover_year - parameters.baseline_year
    if horizon < 1 or horizon > 100:
        raise ModelValidationError("observedCoverYear", "must be between 1 and 100 years after the baseline year")

    def residual(value: float) -> float:
        result = simulate(
            _replace_parameter(parameters, key, value),
            initial_cover_percent,
            horizon,
            solver=solver,
            condition_bands=condition_bands,
        )
        return result.final_cover_percent - observed_cover_percent

    low, high = CALIBRATION_BRACKETS[key]
    search_bracket = [low, high]
    f_low = residual(low)
    f_high = residual(high)
    if f_low == 0.0:
        fitted = low
    elif f_high == 0.0:
        fitted = high
    elif f_low * f_high > 0.0:
        raise ModelValidationError(
            key,
            f"no value in [{low}, {high}] reproduces {observed_cover_percent}% in {observed_cover_year}; "
            "the observed change may come from other drivers",
        )
    else:
        increasing = f_high > f_low
        for _ in range(max_iterations):
            if high - low <= 1e-12 * max(1.0, abs(low)):
                break
            middle = 0.5 * (low + high)
            f_middle = residual(middle)
            if f_middle == 0.0:
                low = high = middle
                break
            if (f_middle > 0.0) == increasing:
                high = middle
            else:
                low = middle
        fitted = 0.5 * (low + high)

    check = simulate(
        _replace_parameter(parameters, key, fitted),
        initial_cover_percent,
        horizon,
        solver=solver,
        condition_bands=condition_bands,
    )
    warnings = [
        f"{key} = {fitted:.6g} is a data fit to observed cover, not a published paper value.",
        "Use this estimate as a reviewed model configuration value, not as a silent runtime override.",
        "Provisional K and beta values were held fixed during this fit, so it inherits their uncertainty.",
    ]
    return {
        "parameterKey": key,
        "value": fitted,
        "searchBracket": search_bracket,
        "observedCoverPercent": observed_cover_percent,
        "observedCoverYear": observed_cover_year,
        "fittedFinalCoverPercent": check.final_cover_percent,
        "absoluteResidualPercent": abs(check.final_cover_percent - observed_cover_percent),
        "method": (
            f"bisection on {key} over the full RK4 integration of the CCOverT equation, "
            f"reproducing {observed_cover_percent}% in {observed_cover_year}"
        ),
        "note": (
            f"Fitted to observed cover change from {initial_cover_percent}% ({parameters.baseline_year}) "
            f"to {observed_cover_percent}% ({observed_cover_year})."
        ),
        "warnings": warnings,
    }


def thermal_activation_year(parameters: ModelParameters) -> Optional[float]:
    """First year at which T(t) reaches Tcrit, or None when it never does.

    This is derived from the configured parameters only. With the paper's
    reported T0 = 30.19, gamma = 0.013 and Tcrit = 31 the thermal term stays
    inactive until roughly 2068, which is a property of the published
    parameters rather than an assumption of this implementation.
    """

    if parameters.gamma <= 0.0 or parameters.tcrit <= parameters.t0:
        return None
    return parameters.baseline_year + (parameters.tcrit - parameters.t0) / parameters.gamma


def thermal_term_inactive_for_horizon(parameters: ModelParameters, horizon_years: int) -> bool:
    """Return whether ``max(0, T(t) - Tcrit)`` is zero for the full run.

    ``T(t)`` is linear, so its maximum on ``[0, horizon_years]`` is one of
    the two endpoints. This helper is used only for the explicit exception
    that a missing alpha is not needed when the thermal term cannot activate.
    """

    if horizon_years < 1:
        return False
    start = parameters.temperature(0.0)
    end = parameters.temperature(float(horizon_years))
    return max(start, end) <= parameters.tcrit


def parameter_warnings(parameters: ModelParameters) -> list[str]:
    """Warnings that must accompany any result built from the paper parameters."""

    warnings: list[str] = []
    for note in (
        "K = 70 is a provisional value recovered from the handwritten Appendix C calculation and is not independently verified.",
        "beta = 5.6743e-8 is a provisional value recovered from the handwritten Appendix C calculation; its units are unclear in the paper.",
    ):
        warnings.append(f"Provisional parameter: {note}")
    return warnings


def provisional_keys() -> tuple[str, ...]:
    return ("K", "beta")


def status_for(key: str, value: Optional[float]) -> str:
    if value is None:
        return "unspecified-in-paper"
    if key in provisional_keys():
        return STATUS_PROVISIONAL
    return "reported"


def demo_profile_warning() -> str:
    return (
        f"DEMO result: this prediction used the {STATUS_SYNTHETIC_DEMO} profile with synthetic alpha and g values "
        "so the request path could be exercised. It is not a research forecast."
    )


def metadata() -> dict[str, Any]:
    """Model manifest returned by ``GET /model/metadata``."""

    from .parameters import (  # local import keeps the module import-light
        CONDITION_CONVENTION,
        DEMO_PROFILE,
        PAPER_CONFLICTS,
        PAPER_PARAMETER_SPECS,
        SOLVER_DEFAULTS,
        STUDY_AREA,
        PAPER_REPRODUCTION_CONFIG_VERSION,
        PAPER_REPRODUCTION_LABEL,
        PAPER_REPRODUCTION_TOURISM_PERIODS,
        TOURISM_CONFIG_VERSION,
    )

    return {
        "equationVersion": EQUATION_VERSION,
        "modelVersion": MODEL_VERSION,
        "equations": dict(EQUATIONS),
        "requiredParameters": list(REQUIRED_PARAMETER_KEYS),
        "parameters": [spec.to_dict() for spec in PAPER_PARAMETER_SPECS],
        "provisionalParameters": list(provisional_keys()),
        "conditionConvention": CONDITION_CONVENTION,
        "solver": dict(SOLVER_DEFAULTS),
        "studyArea": STUDY_AREA,
        "paperConflicts": [dict(item) for item in PAPER_CONFLICTS],
        "demoProfile": dict(DEMO_PROFILE),
        "paperReproductionProfile": {
            "version": PAPER_REPRODUCTION_CONFIG_VERSION,
            "label": PAPER_REPRODUCTION_LABEL,
            "alpha": 0.05,
            "initialCoverPercent": 57.0,
            "initialCoverYear": 2006,
            "tourismConfigVersion": TOURISM_CONFIG_VERSION,
            "tourismGrowthPeriods": [dict(period) for period in PAPER_REPRODUCTION_TOURISM_PERIODS],
        },
        "targetMeasure": "%LCC (HC+SC) in percentage points on a 0-100 scale",
    }
