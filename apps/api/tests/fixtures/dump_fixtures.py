"""Regenerate the recorded model-service fixtures used by the API contract tests.

The workflow suite replays these files instead of hand-written payloads, so the
TypeScript schemas are checked against real FastAPI output. Run from the
repository root:

    python apps/api/tests/fixtures/dump_fixtures.py

The script refuses to overwrite a fixture with an error response, so a broken
model service fails loudly here instead of quietly weakening the tests.
"""

import json
import os
import sys

ROOT = os.getcwd()
sys.path.insert(0, os.path.join(ROOT, "services", "model-api"))

from fastapi.testclient import TestClient  # noqa: E402

from ccover_model.api import app  # noqa: E402

FIXTURE_DIR = os.path.join(ROOT, "apps", "api", "tests", "fixtures")
HEADERS = {}
if os.getenv("MODEL_SERVICE_TOKEN"):
    HEADERS["x-service-token"] = os.environ["MODEL_SERVICE_TOKEN"]

PARAMETERS = {
    "r": 0.028,
    "alpha": 0.05,
    "beta": 5.6743e-8,
    "gamma": 0.013,
    "T0": 30.19,
    "Tcrit": 31.0,
    "V0": 147806.0,
    "g": 0.02,
    "K": 70.0,
}

PREDICT_BODY = {
    "studyAreaId": "puerto-princesa-city",
    "studyAreaLabel": "Puerto Princesa City, Palawan, Philippines",
    "scope": "citywide-annual-average",
    "profile": "paper",
    "baselineYear": 2006,
    "horizonYears": 2,
    "coralBaseline": {
        "coverPercent": 57.25,
        "year": 2006,
        "measure": "%LCC (HC+SC)",
        "surveySource": "Fixture survey",
        "surveyScope": "citywide-annual-average",
    },
    "parameters": {
        key: {
            "value": value,
            "unit": "unit",
            "status": "reported",
            "provenance": "fixture",
            "reviewStatus": "reviewed",
        }
        for key, value in PARAMETERS.items()
    },
    "solver": {"method": "rk4", "substepsPerYear": 12, "intervalMeanQuadrature": "trapezoid"},
    "modelConfigVersion": "fixture-1",
    "requestId": "fixture-request-1",
    "sources": [
        {"name": "coralBaseline", "source": "Fixture survey", "unit": "percent", "timeWindow": "2006"}
    ],
}


def write(name, payload):
    path = os.path.join(FIXTURE_DIR, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    print("wrote", os.path.relpath(path, ROOT))


def main():
    client = TestClient(app)

    metadata = client.get("/model/metadata", headers=HEADERS)
    if metadata.status_code != 200:
        sys.exit("metadata request failed: %s %s" % (metadata.status_code, metadata.text[:300]))
    write("model-metadata.json", metadata.json())

    prediction = client.post("/model/predict", json=PREDICT_BODY, headers=HEADERS)
    if prediction.status_code != 200:
        sys.exit("predict request failed: %s %s" % (prediction.status_code, prediction.text[:300]))
    write("predict-response.json", prediction.json())

    print("metadata keys:", sorted(metadata.json()))
    print("predict keys:", sorted(prediction.json()))


if __name__ == "__main__":
    main()
