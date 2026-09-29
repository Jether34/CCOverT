"""Tests for the CCOverT model service and the published equation.

Run from the repository root:

    python -m unittest discover -s services/model-api/tests -t services/model-api -p "test_*.py"
"""

from __future__ import annotations

import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

from ccover_model import model as model_module  # noqa: E402
from ccover_model.api import app  # noqa: E402
from ccover_model.model import (  # noqa: E402
    ModelParameters,
    ModelValidationError,
    ParametersNotConfiguredError,
    SolverSettings,
    classify_percent,
    metadata,
    simulate,
    thermal_activation_year,
    validate_condition_bands,
)
from ccover_model.parameters import (  # noqa: E402
    DEMO_SYNTHETIC_PARAMETERS,
    PROVISIONAL_CONDITION_BANDS,
    REQUIRED_PARAMETER_KEYS,
    STATUS_PROVISIONAL,
    STATUS_UNSPECIFIED,
    PAPER_REPRODUCTION_TOURISM_PERIODS,
)

COMPLETE_PARAMETERS: dict[str, float] = {
    "r": 0.028,
    "alpha": 0.05,
    "beta": 5.6743e-8,
    "gamma": 0.013,
    "T0": 30.19,
    "Tcrit": 31.0,
    "V0": 147806.0,
    "g": 0.02,
    "K": 70.0,
    "baselineYear": 2006,
}


def model_request(**overrides) -> dict:
    body = {
        "studyAreaId": "puerto-princesa-city",
        "studyAreaLabel": "Puerto Princesa City, Palawan, Philippines",
        "scope": "citywide-annual-average",
        "profile": "paper",
        "baselineYear": 2006,
        "horizonYears": 3,
        "coralBaseline": {
            "coverPercent": 57.0,
            "year": 2006,
            "measure": "%LCC (HC+SC)",
            "surveySource": "Test survey fixture 2006",
            "surveyScope": "citywide-annual-average",
        },
        "parameters": {
            key: {
                "value": value,
                "unit": "unit",
                "status": "reported",
                "provenance": "Test fixture",
                "reviewStatus": "reviewed",
            }
            for key, value in COMPLETE_PARAMETERS.items()
            if key != "baselineYear"
        },
        "solver": {"method": "rk4", "substepsPerYear": 12, "intervalMeanQuadrature": "trapezoid"},
        "modelConfigVersion": "test-config-1",
        "sources": [
            {
                "name": "coralBaseline",
                "source": "Test survey fixture 2006",
                "unit": "percent",
                "timeWindow": "2006",
                "coverage": "citywide annual average",
                "scope": "citywide-annual-average",
            }
        ],
    }
    body.update(overrides)
    return body


class DriverTests(unittest.TestCase):
    def test_piecewise_tourism_is_continuous_and_uses_periods(self) -> None:
        parameters = ModelParameters.from_mapping({
            **COMPLETE_PARAMETERS,
            "tourismGrowthPeriods": list(PAPER_REPRODUCTION_TOURISM_PERIODS),
        })
        self.assertEqual(parameters.baseline_year, 2006)
        self.assertAlmostEqual(parameters.temperature(0.0), 30.19, places=12)
        self.assertAlmostEqual(parameters.tourism(0.0), 147806.0, places=6)
        first_end = 147806.0 * math.exp(0.213314 * 11)
        self.assertAlmostEqual(parameters.tourism(11.0), first_end, places=4)
        self.assertAlmostEqual(parameters.tourism(11.000001), first_end, places=2)
        self.assertAlmostEqual(parameters.tourism_growth_rate(10.0), 0.213314, places=6)
        self.assertEqual(parameters.tourism_growth_rate(11.0), 0.0)
        self.assertEqual(parameters.tourism_growth_rate(17.0), 0.128708)
        self.assertEqual(parameters.tourism_growth_rate(21.0), 0.128708)

    def test_paper_reproduction_supports_forecast_end_years_2026_2030_and_2036(self) -> None:
        parameters = ModelParameters.from_mapping({
            **COMPLETE_PARAMETERS,
            "tourismGrowthPeriods": list(PAPER_REPRODUCTION_TOURISM_PERIODS),
        })
        for end_year in (2026, 2030, 2036):
            result = simulate(parameters, initial_cover_percent=57.0, horizon_years=end_year - 2006)
            self.assertEqual(result.annual[-1].year, end_year)
            self.assertGreater(result.annual[-1].tourism_end_arrivals, result.annual[-1].tourism_start_arrivals)
            self.assertAlmostEqual(result.annual[-1].tourism_growth_rate, 0.128708, places=6)
        # After 2026, the model grows the continuous value; it does not reuse
        # the 2026 observation or reset to V0.
        self.assertGreater(parameters.tourism(30.0), parameters.tourism(20.0))

    def test_piecewise_periods_reject_overlap_and_gaps(self) -> None:
        with self.assertRaises(ModelValidationError):
            ModelParameters.from_mapping({
                **COMPLETE_PARAMETERS,
                "tourismGrowthPeriods": [
                    {"startYear": 2006, "endYear": 2016, "growthRate": 0.1},
                    {"startYear": 2018, "endYear": 2020, "growthRate": 0.1},
                ],
            })

    def test_paper_reproduction_response_echoes_periods_and_label_warning(self) -> None:
        body = model_request(
            profile="paper-reproduction",
            modelConfigVersion="paper-reproduction-1.0.0",
            tourismGrowthPeriods=list(PAPER_REPRODUCTION_TOURISM_PERIODS),
            parameters={
                key: {
                    "value": value,
                    "unit": "unit",
                    "status": "paper-stated",
                    "provenance": "confirmed fixture",
                    "reviewStatus": "unreviewed",
                }
                for key, value in COMPLETE_PARAMETERS.items()
                if key != "baselineYear"
            },
        )
        response = TestClient(app).post("/model/predict", json=body, headers={"x-service-token": "test-token"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["isPaperReproduction"])
        self.assertEqual(payload["tourismGrowthPeriods"][1]["growthRate"], 0.0)
        self.assertTrue(any("Independent scientific validation is pending" in warning for warning in payload["warnings"]))

    def test_temperature_and_tourism_drivers_match_the_equation(self) -> None:
        parameters = ModelParameters.from_mapping(COMPLETE_PARAMETERS)
        for t in (0.0, 5.5, 20.0):
            self.assertAlmostEqual(parameters.temperature(t), 30.19 + 0.013 * t, places=12)
            self.assertAlmostEqual(parameters.tourism(t), 147806.0 * math.exp(0.02 * t), places=6)

    def test_derivative_matches_the_published_expression(self) -> None:
        parameters = ModelParameters.from_mapping(COMPLETE_PARAMETERS)
        cover, t = 46.0, 10.0
        expected = (
            parameters.r * cover * (1.0 - cover / parameters.k)
            - parameters.alpha * max(0.0, parameters.temperature(t) - parameters.tcrit) * cover
            - parameters.beta * parameters.tourism(t) * cover
        )
        self.assertAlmostEqual(parameters.derivative(cover, t), expected, places=12)

    def test_thermal_term_is_inactive_below_the_critical_temperature(self) -> None:
        parameters = ModelParameters.from_mapping({**COMPLETE_PARAMETERS, "T0": 25.0, "gamma": 0.0})
        _growth, thermal, _tourism = parameters.components(50.0, 3.0)
        self.assertEqual(thermal, 0.0)


class SimulationTests(unittest.TestCase):
    def test_annual_state_and_interval_mean_are_reported_for_every_year(self) -> None:
        parameters = ModelParameters.from_mapping(COMPLETE_PARAMETERS)
        result = simulate(parameters, 57.0, 10, SolverSettings(substeps_per_year=12))
        self.assertEqual(len(result.annual), 10)
        self.assertEqual([item.year for item in result.annual], list(range(2007, 2017)))
        for item in result.annual:
            self.assertTrue(0.0 <= item.cover_end_percent <= 100.0)
            self.assertTrue(0.0 <= item.cover_interval_mean_percent <= 100.0)
            self.assertTrue(math.isfinite(item.growth_rate_mean))
        self.assertAlmostEqual(result.final_cover_percent, result.annual[-1].cover_end_percent, places=12)
        self.assertAlmostEqual(result.final_interval_mean_percent, result.annual[-1].cover_interval_mean_percent, places=12)

    def test_components_sum_to_the_annual_change_in_cover(self) -> None:
        parameters = ModelParameters.from_mapping(COMPLETE_PARAMETERS)
        result = simulate(parameters, 57.0, 5, SolverSettings(substeps_per_year=24))
        for item in result.annual:
            total = item.growth_contribution_pp + item.thermal_contribution_pp + item.tourism_contribution_pp
            self.assertAlmostEqual(total, item.cover_end_percent - item.cover_start_percent, places=6)

    def test_shrinking_tourism_and_temperature_growth_reduces_cover(self) -> None:
        parameters = ModelParameters.from_mapping({**COMPLETE_PARAMETERS, "g": 0.0, "alpha": 0.0})
        without_pressures = simulate(parameters, 57.0, 10).final_cover_percent
        with_pressures = simulate(ModelParameters.from_mapping(COMPLETE_PARAMETERS), 57.0, 10).final_cover_percent
        self.assertLess(with_pressures, without_pressures)

    def test_zero_pressures_match_the_closed_form_logistic_solution(self) -> None:
        parameters = ModelParameters.from_mapping({**COMPLETE_PARAMETERS, "alpha": 0.0, "beta": 0.0})
        result = simulate(parameters, 20.0, 5, SolverSettings(substeps_per_year=200))
        expected = 70.0 / (1.0 + (70.0 / 20.0 - 1.0) * math.exp(-0.028 * 5))
        self.assertAlmostEqual(result.final_cover_percent, expected, places=6)

    def test_solver_settings_are_recorded_with_the_result(self) -> None:
        parameters = ModelParameters.from_mapping(COMPLETE_PARAMETERS)
        result = simulate(parameters, 57.0, 1, SolverSettings(substeps_per_year=4))
        self.assertEqual(result.solver.method, "rk4")
        self.assertEqual(result.solver.substeps_per_year, 4)
        self.assertEqual(result.solver.to_dict()["intervalMeanQuadrature"], "trapezoid")
        self.assertEqual(result.equation_version, "ccoverT-1.0.0")

    def test_thermal_inactivity_with_the_paper_parameters_is_reported(self) -> None:
        result = simulate(ModelParameters.from_mapping(COMPLETE_PARAMETERS), 57.0, 10)
        self.assertTrue(any("thermal term" in warning and "inactive" in warning for warning in result.warnings))
        self.assertEqual(thermal_activation_year(ModelParameters.from_mapping(COMPLETE_PARAMETERS)) is not None, True)
        immediate = ModelParameters.from_mapping({**COMPLETE_PARAMETERS, "T0": 31.5})
        self.assertIsNone(thermal_activation_year(immediate))

    def test_provisional_parameters_produce_visible_warnings(self) -> None:
        result = simulate(ModelParameters.from_mapping(COMPLETE_PARAMETERS), 57.0, 1)
        joined = " ".join(result.warnings)
        self.assertIn("Provisional parameter", joined)
        self.assertIn("K = 70", joined)
        self.assertIn("beta = 5.6743e-8", joined)

    def test_cover_is_held_inside_the_physical_range_with_a_warning(self) -> None:
        parameters = ModelParameters.from_mapping({**COMPLETE_PARAMETERS, "alpha": 0.0, "g": 0.0, "beta": 5.6743e-4})
        result = simulate(parameters, 2.0, 5)
        self.assertGreaterEqual(result.final_cover_percent, 0.0)
        self.assertLessEqual(result.final_cover_percent, 100.0)
        for item in result.annual:
            self.assertGreaterEqual(item.cover_start_percent, 0.0)
            self.assertLessEqual(item.cover_end_percent, 100.0)
        self.assertTrue(any("physical" in warning and "bound" in warning for warning in result.warnings))


class ValidationTests(unittest.TestCase):
    def test_missing_required_parameters_are_reported_and_never_substituted(self) -> None:
        incomplete = {key: value for key, value in COMPLETE_PARAMETERS.items() if key not in {"alpha", "g"}}
        with self.assertRaises(ParametersNotConfiguredError) as context:
            ModelParameters.from_mapping(incomplete)
        missing = {item["key"] for item in context.exception.missing}
        self.assertEqual(missing, {"alpha", "g"})

    def test_null_parameter_is_treated_as_missing(self) -> None:
        payload = {**COMPLETE_PARAMETERS, "alpha": None}
        with self.assertRaises(ParametersNotConfiguredError):
            ModelParameters.from_mapping(payload)

    def test_non_finite_and_out_of_range_values_are_rejected(self) -> None:
        cases = {
            "r": (float("inf"), "r"),
            "alpha": (-1.0, "alpha"),
            "beta": (-1.0, "beta"),
            "T0": (99.0, "T0"),
            "Tcrit": (-40.0, "Tcrit"),
            "V0": (-5.0, "V0"),
            "g": (2.0, "g"),
            "K": (0.0, "K"),
        }
        for key, (value, field) in cases.items():
            with self.subTest(key=key):
                with self.assertRaises(ModelValidationError) as context:
                    ModelParameters.from_mapping({**COMPLETE_PARAMETERS, key: value})
                self.assertEqual(context.exception.field, field)

    def test_initial_cover_and_horizon_are_validated(self) -> None:
        parameters = ModelParameters.from_mapping(COMPLETE_PARAMETERS)
        with self.assertRaises(ModelValidationError):
            simulate(parameters, 140.0, 5)
        with self.assertRaises(ModelValidationError):
            simulate(parameters, -1.0, 5)
        with self.assertRaises(ModelValidationError):
            simulate(parameters, 50.0, 0)
        with self.assertRaises(ModelValidationError):
            simulate(parameters, 50.0, 101)
        with self.assertRaises(ModelValidationError):
            simulate(parameters, float("nan"), 5)

    def test_condition_bands_must_be_gap_free(self) -> None:
        with self.assertRaises(ModelValidationError):
            validate_condition_bands(
                [
                    {"label": "Poor", "minPercent": 0, "maxPercent": 25, "upperInclusive": False},
                    {"label": "Fair", "minPercent": 26, "maxPercent": 50, "upperInclusive": False},
                    {"label": "Good", "minPercent": 50, "maxPercent": 100, "upperInclusive": True},
                ]
            )
        with self.assertRaises(ModelValidationError):
            validate_condition_bands(
                [
                    {"label": "Poor", "minPercent": 0, "maxPercent": 25, "upperInclusive": False},
                    {"label": "Good", "minPercent": 25, "maxPercent": 75, "upperInclusive": False},
                ]
            )
        bands = validate_condition_bands(PROVISIONAL_CONDITION_BANDS)
        self.assertEqual(classify_percent(24.999, bands), "Poor")
        self.assertEqual(classify_percent(25.0, bands), "Fair")
        self.assertEqual(classify_percent(75.0, bands), "Excellent")
        self.assertEqual(classify_percent(100.0, bands), "Excellent")


class ModelBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_readiness_reports_the_unconfigured_parameters(self) -> None:
        response = self.client.get("/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["unconfiguredParameters"], ["alpha", "g"])

    def test_paper_reproduction_profile_is_distinct_and_inactive_alpha_is_explicit(self) -> None:
        body = model_request(profile="paper-reproduction", horizonYears=1)
        body["parameters"]["alpha"]["value"] = None
        body["parameters"]["alpha"]["status"] = "inactive-for-horizon"
        # With the listed T0/gamma/Tcrit values, one year remains below Tcrit.
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["profile"], "paper-reproduction")
        self.assertFalse(result["isDemo"])
        self.assertFalse(result["isScenario"])
        self.assertTrue(any("Alpha was not numerically required" in warning for warning in result["warnings"]))

    def test_paper_reproduction_requires_alpha_after_thermal_crossing(self) -> None:
        body = model_request(profile="paper-reproduction", horizonYears=100)
        body["parameters"]["alpha"]["value"] = None
        response = self.client.post("/model/predict", json=body)
        self.assertIn(response.status_code, (409, 422))
        self.assertIn('alpha', json.dumps(response.json()).lower())

    def test_model_metadata_exposes_the_equation_and_provenance(self) -> None:
        response = self.client.get("/model/metadata")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("dC/dt = r*C*(1 - C/K)", body["equations"]["coralCover"])
        statuses = {item["key"]: item["status"] for item in body["parameters"]}
        self.assertEqual(statuses["K"], STATUS_PROVISIONAL)
        self.assertEqual(statuses["beta"], STATUS_PROVISIONAL)
        self.assertEqual(statuses["alpha"], STATUS_UNSPECIFIED)
        self.assertEqual(statuses["g"], STATUS_UNSPECIFIED)
        self.assertEqual(body["provisionalParameters"], ["K", "beta"])

    def test_validation_endpoint_reports_holdout_metrics_and_never_validates(self) -> None:
        # gamma is chosen so the SST driver crosses Tcrit inside the training
        # window; otherwise alpha is unidentifiable and the fit must refuse.
        values = {**COMPLETE_PARAMETERS, "T0": 29.0, "gamma": 0.5, "Tcrit": 30.0, "V0": 100000.0}
        reference = ModelParameters.from_mapping({**values, "baselineYear": 2006})
        cover = [(2006, 55.0)] + [
            (point.year, point.cover_end_percent) for point in simulate(reference, 55.0, 8).annual
        ]
        arrivals = [(year, reference.tourism(year - 2006)) for year in range(2006, 2015)]
        response = self.client.post("/model/validate", json={
            "studyAreaId": "puerto-princesa-city",
            "baselineYear": 2006,
            "parameters": {
                key: {"value": value, "unit": "unit", "status": "reported", "provenance": "Test fixture", "reviewStatus": "reviewed"}
                for key, value in values.items() if key != "baselineYear"
            },
            "coralCover": {"label": "Citywide %LCC survey series", "points": [[year, value] for year, value in cover]},
            "tourism": {"label": "Citywide annual arrivals", "points": [[year, value] for year, value in arrivals]},
            "trainEndYear": 2012,
            "trainingDatasetVersion": "training-v1",
            "validationDatasetVersion": "validation-v1",
            "bootstrapSamples": 5,
            "seed": 3,
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["holdout"]["holdoutYears"], [2013, 2014])
        self.assertIn("historicalMean", body["holdout"]["baselines"])
        self.assertIn("rollingOriginTrainingOnly", body["holdout"])
        self.assertEqual(len(body["fitting"]["bootstrap95PercentIntervals"]["alpha"]), 2)
        self.assertEqual(body["fitting"]["trainThroughYear"], 2012)
        self.assertEqual(body["dataProvenance"]["trainingDatasetVersion"], "training-v1")
        self.assertIn("nothing is marked validated", body["status"])
        joined = " ".join(body["warnings"])
        self.assertIn("not paper values", joined)
        self.assertIn("Adopting one requires a new reviewed model configuration version", joined)

    def test_validation_endpoint_refuses_to_fit_an_unidentifiable_alpha(self) -> None:
        # The default fixture never crosses Tcrit, so alpha cannot be estimated.
        values = {**COMPLETE_PARAMETERS, "T0": 29.0, "gamma": 0.01, "Tcrit": 31.0}
        reference = ModelParameters.from_mapping({**values, "baselineYear": 2006})
        cover = [(2006, 55.0)] + [
            (point.year, point.cover_end_percent) for point in simulate(reference, 55.0, 8).annual
        ]
        arrivals = [(year, reference.tourism(year - 2006)) for year in range(2006, 2015)]
        response = self.client.post("/model/validate", json={
            "baselineYear": 2006,
            "parameters": {
                key: {"value": value, "unit": "unit", "status": "reported", "provenance": "Test fixture", "reviewStatus": "reviewed"}
                for key, value in values.items() if key != "baselineYear"
            },
            "coralCover": {"label": "Cover", "points": [[year, value] for year, value in cover]},
            "tourism": {"label": "Arrivals", "points": [[year, value] for year, value in arrivals]},
            "trainEndYear": 2012,
            "trainingDatasetVersion": "training-v1",
            "validationDatasetVersion": "validation-v1",
            "bootstrapSamples": 5,
        })
        self.assertNotEqual(response.status_code, 200)
        self.assertIn("alpha cannot be identified", json.dumps(response.json()))

    def test_validation_endpoint_refuses_a_missing_parameter(self) -> None:
        response = self.client.post("/model/validate", json={
            "baselineYear": 2006,
            "parameters": {
                key: {"value": value, "unit": "unit", "status": "reported", "provenance": "Test fixture", "reviewStatus": "reviewed"}
                for key, value in COMPLETE_PARAMETERS.items() if key not in ("baselineYear", "alpha")
            },
            "coralCover": {"label": "Cover", "points": [[2006, 55.0], [2007, 55.1], [2008, 55.2], [2009, 55.0], [2010, 54.6], [2011, 54.0], [2012, 53.4], [2013, 52.9], [2014, 52.4]]},
            "tourism": {"label": "Arrivals", "points": [[year, 100000 * 1.02 ** (year - 2006)] for year in range(2006, 2015)]},
            "trainEndYear": 2012,
            "trainingDatasetVersion": "training-v1",
            "validationDatasetVersion": "validation-v1",
        })
        self.assertNotEqual(response.status_code, 200)
        self.assertEqual(response.json()["error"]["code"], "MODEL_PARAMETERS_NOT_CONFIGURED")
        self.assertEqual(response.json()["error"]["details"]["missing"][0]["key"], "alpha")

    def test_validation_endpoint_requires_the_service_token(self) -> None:
        original = os.environ.get("MODEL_SERVICE_TOKEN")
        os.environ["MODEL_SERVICE_TOKEN"] = "test-token-0123456789abcdef"
        try:
            import importlib

            from ccover_model import api as api_module

            reloaded = importlib.reload(api_module)
            client = TestClient(reloaded.app)
            response = client.post("/model/validate", json={
                "baselineYear": 2006,
                "parameters": {
                    key: {"value": value, "unit": "unit", "status": "reported", "provenance": "Test fixture", "reviewStatus": "reviewed"}
                    for key, value in COMPLETE_PARAMETERS.items() if key != "baselineYear"
                },
                "coralCover": {"label": "Cover", "points": [[2006, 55.0], [2007, 55.1], [2008, 55.2], [2009, 55.0], [2010, 54.6], [2011, 54.0], [2012, 53.4], [2013, 52.9], [2014, 52.4]]},
                "tourism": {"label": "Arrivals", "points": [[year, 100000 * 1.02 ** (year - 2006)] for year in range(2006, 2015)]},
                "trainEndYear": 2012,
                "trainingDatasetVersion": "training-v1",
                "validationDatasetVersion": "validation-v1",
            })
            self.assertEqual(response.status_code, 401)
        finally:
            if original is None:
                os.environ.pop("MODEL_SERVICE_TOKEN", None)
            else:
                os.environ["MODEL_SERVICE_TOKEN"] = original
            import importlib

            from ccover_model import api as api_module

            importlib.reload(api_module)

    def test_prediction_without_alpha_and_g_never_returns_an_estimate(self) -> None:
        body = model_request()
        body["parameters"].pop("alpha")
        body["parameters"].pop("g")
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 409)
        payload = response.json()["error"]
        self.assertEqual(payload["code"], "MODEL_PARAMETERS_NOT_CONFIGURED")
        self.assertEqual({item["key"] for item in payload["details"]["missing"]}, {"alpha", "g"})
        self.assertNotIn("finalCoverPercent", response.json())

    def test_missing_alpha_is_allowed_when_the_thermal_term_stays_inactive(self) -> None:
        body = model_request()
        body["parameters"].pop("alpha")
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        alpha = next(item for item in payload["parameters"] if item["key"] == "alpha")
        self.assertEqual(alpha["value"], 0.0)
        self.assertEqual(alpha["status"], "not-required-for-horizon")
        self.assertTrue(all(item["thermalContributionPp"] == 0.0 for item in payload["annual"]))
        self.assertTrue(any("not numerically required" in warning for warning in payload["warnings"]))

    def test_missing_alpha_is_refused_when_the_horizon_crosses_tcrit(self) -> None:
        body = model_request(horizonYears=100)
        body["parameters"].pop("alpha")
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 409, response.text)
        missing = response.json()["error"]["details"]["missing"]
        self.assertEqual({item["key"] for item in missing}, {"alpha"})

    def test_prediction_returns_annual_output_components_and_warnings(self) -> None:
        response = self.client.post("/model/predict", json=model_request(horizonYears=4))
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["equationVersion"], "ccoverT-1.0.0")
        self.assertEqual(body["modelConfigVersion"], "test-config-1")
        self.assertEqual(len(body["annual"]), 4)
        first = body["annual"][0]
        for key in (
            "coverStartPercent",
            "coverEndPercent",
            "coverIntervalMeanPercent",
            "growthContributionPp",
            "thermalContributionPp",
            "tourismContributionPp",
            "temperatureStartC",
            "tourismStartArrivals",
        ):
            self.assertIn(key, first)
        self.assertEqual(body["solver"]["method"], "rk4")
        self.assertTrue(any("Provisional parameter" in warning for warning in body["warnings"]))
        self.assertEqual(body["sources"][0]["name"], "coralBaseline")
        self.assertTrue(response.headers.get("x-request-id"))

    def test_demo_profile_results_are_labelled(self) -> None:
        previous = os.environ.get("MODEL_ALLOW_DEMO_PROFILE")
        os.environ["MODEL_ALLOW_DEMO_PROFILE"] = "true"
        try:
            body = model_request()
            body["profile"] = "demo"
            body["parameters"].pop("alpha")
            body["parameters"].pop("g")
            response = self.client.post("/model/predict", json=body)
        finally:
            if previous is None:
                os.environ.pop("MODEL_ALLOW_DEMO_PROFILE", None)
            else:
                os.environ["MODEL_ALLOW_DEMO_PROFILE"] = previous
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["isDemo"])
        self.assertEqual(payload["profile"], "demo")
        self.assertTrue(any(warning.startswith("DEMO result") for warning in payload["warnings"]))
        self.assertEqual(set(DEMO_SYNTHETIC_PARAMETERS), {"alpha", "g"})

    def test_demo_profile_does_not_reuse_supplied_paper_values_for_alpha_or_g(self) -> None:
        previous = os.environ.get("MODEL_ALLOW_DEMO_PROFILE")
        os.environ["MODEL_ALLOW_DEMO_PROFILE"] = "true"
        try:
            body = model_request(profile="demo")
            body["parameters"]["alpha"]["value"] = 0.9
            body["parameters"]["g"]["value"] = 0.4
            response = self.client.post("/model/predict", json=body)
        finally:
            if previous is None:
                os.environ.pop("MODEL_ALLOW_DEMO_PROFILE", None)
            else:
                os.environ["MODEL_ALLOW_DEMO_PROFILE"] = previous
        self.assertEqual(response.status_code, 200, response.text)
        values = {item["key"]: item for item in response.json()["parameters"]}
        self.assertEqual(values["alpha"]["value"], DEMO_SYNTHETIC_PARAMETERS["alpha"])
        self.assertEqual(values["g"]["value"], DEMO_SYNTHETIC_PARAMETERS["g"])
        self.assertEqual(values["alpha"]["status"], "synthetic-demo-only")

    def test_scenario_profile_is_labelled_and_echoes_assumptions(self) -> None:
        """A scenario run is exploratory: the response must never read as validated."""

        body = model_request()
        body["profile"] = "scenario"
        body["parameters"].pop("alpha")
        body["parameters"].pop("g")
        body["parameters"]["alpha"] = {
            "value": 0.05,
            "unit": "per degC per year",
            "status": "assumed",
            "provenance": "Scenario assumption supplied by the analyst: literature midpoint",
            "reviewStatus": "unreviewed",
        }
        body["parameters"]["g"] = {
            "value": 0.02,
            "unit": "per year",
            "status": "assumed",
            "provenance": "Scenario assumption supplied by the analyst: flat tourism what-if",
            "reviewStatus": "unreviewed",
        }
        # The API sends the paper's provisional marker for these two, and it
        # must survive a scenario run rather than being reported as settled.
        for key in ("K", "beta"):
            body["parameters"][key]["status"] = "provisional"
            body["parameters"][key]["reviewStatus"] = "unreviewed"
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["isScenario"])
        self.assertFalse(payload["isDemo"])
        self.assertEqual(payload["profile"], "scenario")
        self.assertTrue(
            any("Exploratory scenario run, not a validated prediction" in warning for warning in payload["warnings"]),
            payload["warnings"],
        )
        # The assumed values come back as assumptions, not as paper values.
        by_key = {item["key"]: item for item in payload["parameters"]}
        self.assertEqual(by_key["alpha"]["status"], "assumed")
        self.assertEqual(by_key["alpha"]["reviewStatus"], "unreviewed")
        self.assertEqual(by_key["alpha"]["value"], 0.05)
        # The provisional status of K and beta is still reported.
        self.assertEqual(by_key["K"]["status"], "provisional")
        self.assertEqual(by_key["beta"]["status"], "provisional")

    def test_scenario_without_values_still_refuses(self) -> None:
        """Supplying a scenario profile is not a way to run without values."""

        body = model_request()
        body["profile"] = "scenario"
        body["parameters"].pop("alpha")
        body["parameters"].pop("g")
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["error"]["code"], "MODEL_PARAMETERS_NOT_CONFIGURED")

    def test_invalid_request_is_rejected(self) -> None:
        body = model_request()
        body["coralBaseline"]["coverPercent"] = 250
        response = self.client.post("/model/predict", json=body)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")

    def test_service_token_is_enforced_when_configured(self) -> None:
        previous = os.environ.get("MODEL_SERVICE_TOKEN")
        os.environ["MODEL_SERVICE_TOKEN"] = "unit-test-service-token"
        try:
            rejected = self.client.post("/model/predict", json=model_request())
            self.assertEqual(rejected.status_code, 401)
            self.assertEqual(rejected.json()["error"]["code"], "SERVICE_TOKEN_INVALID")
            accepted = self.client.post(
                "/model/predict",
                json=model_request(),
                headers={"x-service-token": "unit-test-service-token"},
            )
            self.assertEqual(accepted.status_code, 200)
        finally:
            if previous is None:
                os.environ.pop("MODEL_SERVICE_TOKEN", None)
            else:
                os.environ["MODEL_SERVICE_TOKEN"] = previous

    def test_request_id_is_propagated_from_the_caller(self) -> None:
        response = self.client.post(
            "/model/predict",
            json=model_request(),
            headers={"x-request-id": "node-request-123"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["requestId"], "node-request-123")
        self.assertEqual(response.headers.get("x-request-id"), "node-request-123")

    def test_pagasa_air_temperature_conflict_stays_a_visible_research_note(self) -> None:
        conflicts = {item["id"]: item for item in metadata()["paperConflicts"]}
        self.assertIn("air temperature", conflicts["pagasa-air-temperature"]["detail"])
        self.assertIn("does not reconcile", conflicts["mae-not-reconciled"]["detail"] + conflicts["mae-not-reconciled"]["title"])
        self.assertIn("air temperature is not a substitute", {item["key"]: item["notes"] for item in metadata()["parameters"]}["gamma"])
        self.assertIn("sea-surface temperature", {item["key"]: item["notes"] for item in metadata()["parameters"]}["T0"])


class CalibrationTests(unittest.TestCase):
    """A single parameter is fitted by inverting the published equation."""

    def setUp(self) -> None:
        self.client = TestClient(app)

    def parameters(self, **overrides) -> ModelParameters:
        values = dict(COMPLETE_PARAMETERS)
        values["alpha"] = 0.0
        values.update(overrides)
        return ModelParameters.from_mapping(values)

    def test_fitted_value_reproduces_the_observed_cover(self) -> None:
        fitted = model_module.calibrate_parameter(
            self.parameters(g=0.1),
            "g",
            initial_cover_percent=57.25,
            observed_cover_percent=46.2,
            observed_cover_year=2016,
        )
        self.assertLess(fitted["absoluteResidualPercent"], 1e-6)
        self.assertAlmostEqual(fitted["value"], 0.2064910, places=5)

    def test_fitted_value_is_a_data_fit_and_says_so(self) -> None:
        fitted = model_module.calibrate_parameter(
            self.parameters(),
            "g",
            initial_cover_percent=57.25,
            observed_cover_percent=46.2,
            observed_cover_year=2016,
        )
        self.assertEqual(fitted["parameterKey"], "g")
        self.assertTrue(any("data fit" in warning for warning in fitted["warnings"]))
        self.assertTrue(any("not as a silent runtime override" in warning for warning in fitted["warnings"]))
        self.assertTrue(any("Provisional" in warning for warning in fitted["warnings"]))
        self.assertEqual(fitted["searchBracket"], [0.0, 0.5])

    def test_increasing_cover_cannot_be_fitted_with_a_larger_pressure(self) -> None:
        with self.assertRaises(ModelValidationError):
            model_module.calibrate_parameter(
                self.parameters(),
                "g",
                initial_cover_percent=40.0,
                observed_cover_percent=60.0,
                observed_cover_year=2016,
            )

    def test_cover_increase_can_be_fitted_with_a_larger_growth_rate(self) -> None:
        fitted = model_module.calibrate_parameter(
            self.parameters(alpha=0.0, beta=0.0, g=0.0),
            "r",
            initial_cover_percent=40.0,
            observed_cover_percent=60.0,
            observed_cover_year=2016,
        )
        self.assertAlmostEqual(fitted["value"], 0.1504077, places=6)
        self.assertLess(fitted["absoluteResidualPercent"], 1e-6)

    def test_unreachable_observation_is_reported_instead_of_guessed(self) -> None:
        with self.assertRaises(ModelValidationError) as raised:
            model_module.calibrate_parameter(
                self.parameters(alpha=0.0, beta=0.0, g=0.0),
                "K",
                initial_cover_percent=40.0,
                observed_cover_percent=60.0,
                observed_cover_year=2016,
            )
        self.assertIn("other drivers", str(raised.exception))

    def test_observation_before_the_baseline_year_is_rejected(self) -> None:
        with self.assertRaises(ModelValidationError):
            model_module.calibrate_parameter(
                self.parameters(),
                "g",
                initial_cover_percent=57.25,
                observed_cover_percent=57.0,
                observed_cover_year=2004,
            )

    def test_unknown_parameter_cannot_be_calibrated(self) -> None:
        with self.assertRaises(ModelValidationError):
            model_module.calibrate_parameter(
                self.parameters(),
                "notAParameter",
                initial_cover_percent=57.25,
                observed_cover_percent=46.2,
                observed_cover_year=2016,
            )

    def test_calibration_endpoint_returns_the_fit(self) -> None:
        body = {
            "studyAreaId": "puerto-princesa-city",
            "baselineYear": 2006,
            "parameterKey": "g",
            "initialCoverPercent": 57.25,
            "observedCoverPercent": 46.2,
            "observedCoverYear": 2016,
            "parameters": {
                key: {
                    "value": value,
                    "unit": "unit",
                    "status": "reported",
                    "provenance": "Test fixture",
                    "reviewStatus": "reviewed",
                }
                for key, value in COMPLETE_PARAMETERS.items()
                if key not in ("baselineYear",)
            },
            "solver": {"method": "rk4", "substepsPerYear": 12, "intervalMeanQuadrature": "trapezoid"},
        }
        response = self.client.post("/model/calibrate", json=body)
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["parameterKey"], "g")
        self.assertAlmostEqual(payload["value"], 0.2064910, places=5)
        self.assertLess(payload["absoluteResidualPercent"], 1e-6)
        self.assertTrue(payload["warnings"])

    def test_calibration_endpoint_requires_a_starting_value(self) -> None:
        body = {
            "baselineYear": 2006,
            "parameterKey": "g",
            "initialCoverPercent": 57.25,
            "observedCoverPercent": 46.2,
            "observedCoverYear": 2016,
            "parameters": {
                key: {
                    "value": None if key == "g" else value,
                    "unit": "unit",
                    "status": "reported",
                    "provenance": "Test fixture",
                    "reviewStatus": "reviewed",
                }
                for key, value in COMPLETE_PARAMETERS.items()
                if key not in ("baselineYear",)
            },
        }
        response = self.client.post("/model/calibrate", json=body)
        self.assertEqual(response.status_code, 422)
        self.assertIn("g", json.dumps(response.json()))


if __name__ == "__main__":
    unittest.main()
