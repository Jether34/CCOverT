"""Paper parameters, provenance metadata and research notes for the CCOverT model.

Every value in this module is transcribed from the CCOverT research paper that
accompanied the original project, or is explicitly marked as unconfigured /
synthetic. Nothing here is invented: parameters the paper does not numerically
specify stay unconfigured, and provisional values recovered from the handwritten
appendix calculation are labelled as such.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

EQUATION_VERSION = "ccoverT-1.0.0"
MODEL_VERSION = "ccoverT-paper-implementation"
TOURISM_CONFIG_VERSION = "piecewise-tourism-1.0.0"
PAPER_REPRODUCTION_CONFIG_VERSION = "paper-reproduction-1.0.0"
PAPER_REPRODUCTION_LABEL = (
    "Paper-reproduction prediction using stated, estimated, inferred, and provisional parameters. "
    "Independent scientific validation is pending."
)
EQUATION_SOURCE = (
    "CCOverT research paper, 'A Coral Cover Over Time Model for Predicting Coral "
    "Reef Changes in Puerto Princesa City, Palawan' (CCOverT_.docx), including the "
    "handwritten Appendix C calculation."
)

EQUATIONS: dict[str, str] = {
    "coralCover": "dC/dt = r*C*(1 - C/K) - alpha*max(0, T(t) - Tcrit)*C - beta*V(t)*C",
    "temperature": "T(t) = T0 + gamma*t",
    "tourism": "V(t) = V0*exp(g*t)",
}

# Confirmed paper-reproduction configuration. These values are deliberately
# separate from PAPER_PARAMETER_SPECS: the strict paper profile remains
# unavailable until its missing and unreviewed inputs are resolved.
PAPER_REPRODUCTION_TOURISM_PERIODS: tuple[dict[str, Any], ...] = (
    {"startYear": 2006, "endYear": 2016, "growthRate": 0.213314, "unit": "per year", "provenance": "Confirmed paper-reproduction tourism configuration for Puerto Princesa City annual arrivals.", "reviewStatus": "unreviewed", "effectiveDate": "2026-09-27"},
    {"startYear": 2017, "endYear": 2022, "growthRate": 0.0, "unit": "per year", "provenance": "Confirmed paper-reproduction tourism configuration; no growth period.", "reviewStatus": "unreviewed", "effectiveDate": "2026-09-27"},
    {"startYear": 2023, "endYear": 2026, "growthRate": 0.128708, "unit": "per year", "provenance": "Confirmed paper-reproduction tourism configuration for Puerto Princesa City annual arrivals.", "reviewStatus": "unreviewed", "effectiveDate": "2026-09-27"},
    {"startYear": 2027, "endYear": 9999, "growthRate": 0.128708, "unit": "per year", "provenance": "Confirmed continuation of the 2023-2026 tourism growth rate after 2026.", "reviewStatus": "unreviewed", "effectiveDate": "2026-09-27"},
)

#: Status values used for parameter provenance across the whole application.
STATUS_REPORTED = "reported"
STATUS_PROVISIONAL = "provisional"
STATUS_UNSPECIFIED = "unspecified-in-paper"
STATUS_SYNTHETIC_DEMO = "synthetic-demo-only"


@dataclass(frozen=True)
class ParameterSpec:
    """A single model parameter with its unit, provenance and review state."""

    key: str
    symbol: str
    value: Optional[float]
    unit: str
    status: str
    description: str
    provenance: str
    review_status: str = "unreviewed"
    effective_date: Optional[str] = None
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "symbol": self.symbol,
            "value": self.value,
            "unit": self.unit,
            "status": self.status,
            "description": self.description,
            "provenance": self.provenance,
            "reviewStatus": self.review_status,
            "effectiveDate": self.effective_date,
            "notes": self.notes,
        }


#: Parameters the published equation cannot be evaluated without.
REQUIRED_PARAMETER_KEYS: tuple[str, ...] = (
    "r",
    "alpha",
    "beta",
    "gamma",
    "T0",
    "Tcrit",
    "V0",
    "g",
    "K",
)

#: Parameters that must not be silently replaced by a default.
NO_SUBSTITUTE_KEYS: tuple[str, ...] = ("alpha", "g")


PAPER_PARAMETER_SPECS: tuple[ParameterSpec, ...] = (
    ParameterSpec(
        key="r",
        symbol="r",
        value=0.028,
        unit="per year",
        status=STATUS_REPORTED,
        description="Intrinsic coral-cover growth rate.",
        provenance="CCOverT paper, model parameter table.",
    ),
    ParameterSpec(
        key="alpha",
        symbol="alpha",
        value=None,
        unit="per degree Celsius per year",
        status=STATUS_UNSPECIFIED,
        description=(
            "Thermal stress sensitivity. The paper does not numerically specify "
            "alpha; it is required by the equation and must be supplied by an "
            "authorised researcher with documented provenance."
        ),
        provenance="Not numerically specified in the available paper text.",
        notes="Required. The service refuses to substitute zero.",
    ),
    ParameterSpec(
        key="beta",
        symbol="beta",
        value=5.6743e-8,
        unit="unclear in the paper (per tourist arrival per year, inferred)",
        status=STATUS_PROVISIONAL,
        description="Tourism-pressure sensitivity.",
        provenance="CCOverT paper, handwritten Appendix C calculation.",
        notes="Provisional: value and units still require verification by a researcher.",
    ),
    ParameterSpec(
        key="gamma",
        symbol="gamma",
        value=0.013,
        unit="degrees Celsius per year",
        status=STATUS_REPORTED,
        description="Linear sea-surface-temperature trend.",
        provenance="CCOverT paper, model parameter table.",
        notes="T(t) must be sea-surface temperature; air temperature is not a substitute.",
    ),
    ParameterSpec(
        key="T0",
        symbol="T0",
        value=30.19,
        unit="degrees Celsius",
        status=STATUS_REPORTED,
        description="Sea-surface temperature at the baseline year (t = 0).",
        provenance="CCOverT paper, model parameter table.",
        notes="Confirm that the paper source for T0 is sea-surface temperature.",
    ),
    ParameterSpec(
        key="Tcrit",
        symbol="Tcrit",
        value=31.0,
        unit="degrees Celsius",
        status=STATUS_REPORTED,
        description="Critical sea-surface-temperature threshold.",
        provenance="CCOverT paper, model parameter table.",
    ),
    ParameterSpec(
        key="V0",
        symbol="V0",
        value=147806.0,
        unit="tourist arrivals per year",
        status=STATUS_REPORTED,
        description="Annual tourist arrivals at the baseline year.",
        provenance="CCOverT paper, model parameter table (baseline year 2006).",
        notes="Confirm the study-area coverage of this citywide arrival count.",
    ),
    ParameterSpec(
        key="g",
        symbol="g",
        value=None,
        unit="per year",
        status=STATUS_UNSPECIFIED,
        description=(
            "Continuous growth rate of annual tourist arrivals in V(t) = V0*exp(g*t)."
        ),
        provenance="Not numerically specified in the available paper text.",
        notes=(
            "Required. Estimate only from a verified annual tourism series and "
            "record that series as the source."
        ),
    ),
    ParameterSpec(
        key="K",
        symbol="K",
        value=70.0,
        unit="coral-cover percentage points",
        status=STATUS_PROVISIONAL,
        description="Carrying capacity of live coral cover.",
        provenance="CCOverT paper, handwritten Appendix C calculation.",
        notes="Provisional: must use the same 0-100 percentage-point scale as C.",
    ),
)

PAPER_PARAMETERS_BY_KEY: dict[str, ParameterSpec] = {spec.key: spec for spec in PAPER_PARAMETER_SPECS}


#: Development-only synthetic values used to exercise the full request path.
#: They are NOT research values and every record produced with them is DEMO.
DEMO_SYNTHETIC_PARAMETERS: dict[str, float] = {
    "alpha": 0.05,
    "g": 0.02,
}

DEMO_PROFILE = {
    "id": "demo-synthetic",
    "label": "DEMO (synthetic, development only)",
    "description": (
        "Uses explicitly synthetic alpha and g values so the end-to-end request "
        "path can be exercised. Results are labelled DEMO and are never a forecast."
    ),
    "values": dict(DEMO_SYNTHETIC_PARAMETERS),
    "status": STATUS_SYNTHETIC_DEMO,
}

#: Gap-free provisional condition convention. The paper's own category wording
#: disagrees at 75%, so the application ships a configurable, gap-free set.
PROVISIONAL_CONDITION_BANDS: tuple[dict[str, Any], ...] = (
    {"label": "Poor", "minPercent": 0.0, "maxPercent": 25.0, "upperInclusive": False},
    {"label": "Fair", "minPercent": 25.0, "maxPercent": 50.0, "upperInclusive": False},
    {"label": "Good", "minPercent": 50.0, "maxPercent": 75.0, "upperInclusive": False},
    {"label": "Excellent", "minPercent": 75.0, "maxPercent": 100.0, "upperInclusive": True},
)

CONDITION_CONVENTION = {
    "id": "provisional-gap-free-v1",
    "label": "Provisional gap-free condition convention",
    "source": (
        "Application convention. The paper's condition categories disagree at 75% "
        "cover, so this gap-free convention is used and displayed with its source."
    ),
    "bands": [dict(band) for band in PROVISIONAL_CONDITION_BANDS],
}

#: The paper does not identify its numerical solver or define within-year
#: averaging, so the solver used here is recorded with every result.
SOLVER_DEFAULTS: dict[str, Any] = {
    "method": "rk4",
    "substepsPerYear": 12,
    "intervalMeanQuadrature": "trapezoid",
    "stateOutput": "end-of-year",
    "notes": (
        "The paper does not identify a numerical solver or define within-year "
        "averaging. This application uses classical fourth-order Runge-Kutta with "
        "a fixed substep per year and reports both the end-of-year state and the "
        "trapezoidal interval mean of live coral cover."
    ),
}

#: Inconsistencies found in the paper. They are preserved as visible research
#: notes; they do not block evaluating the published equation.
PAPER_CONFLICTS: tuple[dict[str, str], ...] = (
    {
        "id": "pagasa-air-temperature",
        "severity": "warning",
        "title": "PAGASA appendix pages are not an SST series",
        "detail": (
            "The appendix PAGASA pages show meteorological-station observations, "
            "including air temperature, not a verified sea-surface-temperature time "
            "series. T(t) requires SST in degrees Celsius."
        ),
    },
    {
        "id": "validation-window-conflict",
        "severity": "warning",
        "title": "Validation window conflicts with the results tables",
        "detail": (
            "The accuracy section describes 2015-2017 validation, but the results "
            "tables compare 2006 and 2016. The 2006 observed cover and some 2016 "
            "predictions also conflict between tables."
        ),
    },
    {
        "id": "mae-not-reconciled",
        "severity": "warning",
        "title": "Reported MAE of 0.30 does not reconcile with the displayed values",
        "detail": (
            "The paper reports a mean absolute error of 0.30 that does not follow "
            "from its own displayed table values. It is shown as a paper-reported "
            "claim only and is never presented as an independently verified "
            "accuracy result of this application."
        ),
    },
    {
        "id": "condition-category-conflict",
        "severity": "info",
        "title": "Condition categories disagree at 75% cover",
        "detail": (
            "The paper's condition wording is not gap-free at 75%. This application "
            "uses a configurable, gap-free provisional convention and always shows "
            "which convention produced a label."
        ),
    },
    {
        "id": "unidentified-solver",
        "severity": "info",
        "title": "Solver and within-year averaging are not defined in the paper",
        "detail": (
            "The paper does not identify its numerical solver and does not define "
            "within-year averaging, so the solver settings are recorded with every "
            "prediction."
        ),
    },
    {
        "id": "provisional-parameters",
        "severity": "warning",
        "title": "K and beta are provisional",
        "detail": (
            "K (70) and beta (5.6743e-8) are visible only in the handwritten "
            "Appendix C calculation and are provisional pending verification of "
            "value and units."
        ),
    },
    {
        "id": "baseline-year-inference",
        "severity": "info",
        "title": "The 2006 baseline year is an inference",
        "detail": (
            "The paper's use of 2006 as t = 0 is an inference. The configured "
            "baseline year is stored and displayed with every prediction."
        ),
    },
)

STUDY_AREA = {
    "id": "puerto-princesa-city",
    "label": "Puerto Princesa City, Palawan, Philippines",
    "scope": "citywide-annual-average",
    "description": (
        "The paper models the annual average live coral cover of Puerto Princesa "
        "City. This is a citywide annual model, not a validated per-reef-site or "
        "per-coordinate forecast."
    ),
    "referenceOnlyLabels": ("paper-reported", "paper-reported projection"),
}


@dataclass(frozen=True)
class ParameterConfiguration:
    """A resolved parameter set plus the provenance records that came with it."""

    version: str
    values: dict[str, float]
    specs: tuple[ParameterSpec, ...] = field(default_factory=tuple)
    profile: str = "paper"
    is_demo: bool = False

    def missing_required(self) -> list[str]:
        return [key for key in REQUIRED_PARAMETER_KEYS if self.values.get(key) is None]

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "profile": self.profile,
            "isDemo": self.is_demo,
            "values": dict(self.values),
            "parameters": [spec.to_dict() for spec in self.specs],
        }
