"""
Live contract check between the Express API and this model service.

The API test suite runs against a contract double, so a drift between the
TypeScript request shape and this service's `PredictRequest` can pass the unit
tests and still fail in a real run. This script posts the real wire shape
straight at `POST /model/predict` and asserts the response is labelled, so the
boundary is checked against the real service rather than a stub.

Run with the stack already listening:

    python services/model-api/smoke_contract_check.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

MODEL_URL = os.environ.get("MODEL_SERVICE_URL", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.environ.get("MODEL_SERVICE_TOKEN", "")
BASELINE_YEAR = 2006
TIMEOUT_SECONDS = 30


def post(path: str, body: dict[str, Any]) -> tuple[int, Any]:
    request = urllib.request.Request(
        f"{MODEL_URL}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            **({"x-service-token": TOKEN} if TOKEN else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def assumed(value: float, unit: str, why: str) -> dict[str, Any]:
    return {
        "value": value,
        "unit": unit,
        "status": "assumed",
        "provenance": f"Contract check: {why}",
        "reviewStatus": "unreviewed",
        "source_dataset_id": None,
        "effective_date": None,
    }


def reported(value: float, unit: str) -> dict[str, Any]:
    return {
        "value": value,
        "unit": unit,
        "status": "reported",
        "provenance": "Contract check fixture",
        "reviewStatus": "reviewed",
        "source_dataset_id": None,
        "effective_date": None,
    }


def scenario_body() -> dict[str, Any]:
    """Exactly what the API sends: snake_case, nested parameter provenance."""
    return {
        "study_area_id": "puerto-princesa-city",
        "study_area_label": "Puerto Princesa City, Palawan, Philippines",
        "scope": "citywide-annual-average",
        "consented_location": None,
        "profile": "scenario",
        "baseline_year": BASELINE_YEAR,
        "horizon_years": 3,
        "coral_baseline": {
            "cover_percent": 57.0,
            "year": BASELINE_YEAR,
            "hard_coral_percent": None,
            "soft_coral_percent": None,
            "measure": "%LCC (HC+SC)",
            "survey_source": "Contract check fixture 2006",
            "survey_scope": "citywide-annual-average",
            "same_scope_confirmed": True,
        },
        "parameters": {
            "r": reported(0.028, "per year"),
            "K": {**reported(70.0, "% LCC"), "status": "provisional", "reviewStatus": "unreviewed"},
            "alpha": assumed(0.05, "per degC per year", "explicit what-if"),
            "beta": {**reported(5.6743e-8, "per visitor per year"), "status": "provisional", "reviewStatus": "unreviewed"},
            "gamma": reported(0.013, "degC per year"),
            "T0": reported(30.19, "degC"),
            "Tcrit": reported(31.0, "degC"),
            "V0": reported(147806.0, "visitors per year"),
            "g": assumed(0.02, "per year", "flat tourism what-if"),
        },
        "solver": {
            "method": "rk4",
            "substeps_per_year": 12,
            "interval_mean_quadrature": "trapezoid",
            "state_output": "end-of-year",
        },
        "model_config_version": "contract-check",
        "sources": [],
        "request_id": "contract-check-scenario",
    }


def main() -> int:
    failures: list[str] = []

    def check(label: str, condition: bool) -> None:
        if condition:
            print(f"  ok   {label}")
        else:
            print(f"  FAIL {label}")
            failures.append(label)

    print(f"Checking {MODEL_URL}")

    body = scenario_body()
    status, payload = post("/model/predict", body)
    print(f"scenario run: HTTP {status}")
    if status != 200:
        print(json.dumps(payload, indent=2)[:2000])
        print("  FAIL the API-shaped scenario body was rejected by the model service")
        return 1

    check("profile is scenario", payload.get("profile") == "scenario")
    check("isScenario is true", payload.get("isScenario") is True)
    check("isDemo is false", payload.get("isDemo") is False)
    check(
        "the run is warned as exploratory",
        any("not a validated prediction" in warning for warning in payload.get("warnings", [])),
    )

    echoed = {item["key"]: item for item in payload.get("parameters", [])}
    check("alpha comes back assumed", echoed.get("alpha", {}).get("status") == "assumed")
    check("alpha comes back unreviewed", echoed.get("alpha", {}).get("reviewStatus") == "unreviewed")
    check("g comes back assumed", echoed.get("g", {}).get("status") == "assumed")
    check("K stays provisional", echoed.get("K", {}).get("status") == "provisional")
    check("beta stays provisional", echoed.get("beta", {}).get("status") == "provisional")
    check("the model config version travels", payload.get("modelConfigVersion") == "contract-check")

    incomplete = scenario_body()
    del incomplete["parameters"]["alpha"]
    del incomplete["parameters"]["g"]
    status, payload = post("/model/predict", incomplete)
    check("a scenario without values is still refused", status == 409)
    check(
        "the refusal names the parameters",
        payload.get("error", {}).get("code") == "MODEL_PARAMETERS_NOT_CONFIGURED",
    )

    if failures:
        print(f"\n{len(failures)} contract check(s) failed")
        return 1
    print("\nAll contract checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
