"""Research-only fitting and independent time-based evaluation.

No function here promotes a model configuration to reviewed or validated. The
published equation and RK4 implementation remain in model.py unchanged.
"""

from __future__ import annotations

import math
import random
from dataclasses import replace
from typing import Iterable

from .model import ModelParameters, ModelValidationError, simulate

Observation = tuple[int, float]


def _series(values: Iterable[Observation], name: str, minimum: int) -> list[Observation]:
    result = sorted(values)
    if len(result) < minimum or len({year for year, _ in result}) != len(result):
        raise ModelValidationError(name, f"needs at least {minimum} distinct annual observations")
    if any(not isinstance(year, int) or not math.isfinite(value) for year, value in result):
        raise ModelValidationError(name, "years and values must be finite")
    return result


def _shift(parameters: ModelParameters, year: int) -> ModelParameters:
    elapsed = year - parameters.baseline_year
    return replace(parameters, baseline_year=year, t0=parameters.temperature(elapsed), v0=parameters.tourism(elapsed))


def _metrics(actual: list[float], predicted: list[float], intervals: list[tuple[float, float]] | None = None) -> dict[str, float | None]:
    if not actual or len(actual) != len(predicted):
        raise ModelValidationError("metrics", "matching nonempty actual and predicted series are required")
    errors = [estimate - truth for truth, estimate in zip(actual, predicted)]
    return {
        "mae": sum(abs(error) for error in errors) / len(errors),
        "rmse": math.sqrt(sum(error * error for error in errors) / len(errors)),
        "meanBiasError": sum(errors) / len(errors),
        "predictionIntervalCoverage": None if intervals is None else sum(
            lower <= truth <= upper for truth, (lower, upper) in zip(actual, intervals)
        ) / len(actual),
    }


def _linear_trend(training: list[Observation], year: int) -> float:
    mean_year = sum(item[0] for item in training) / len(training)
    mean_cover = sum(item[1] for item in training) / len(training)
    denominator = sum((item[0] - mean_year) ** 2 for item in training)
    slope = 0.0 if denominator == 0 else sum(
        (item[0] - mean_year) * (item[1] - mean_cover) for item in training
    ) / denominator
    return mean_cover + slope * (year - mean_year)


def evaluate_time_split(
    parameters: ModelParameters,
    observations: Iterable[Observation],
    train_end_year: int,
    validation_dataset_version: str,
    prediction_intervals: dict[int, tuple[float, float]] | None = None,
) -> dict[str, object]:
    """Forecast held-out years using only the last *training* cover as C0.

    Rolling origins are restricted to training years. Future observations never
    enter either calibration or the baselines used for the final holdout.
    """
    series = _series(observations, "coralCover", 6)
    if any(value < 0 or value > 100 for _, value in series):
        raise ModelValidationError("coralCover", "must be on the 0-100 percentage-point scale")
    training = [(year, value) for year, value in series if year <= train_end_year]
    holdout = [(year, value) for year, value in series if year > train_end_year]
    if len(training) < 4 or len(holdout) < 2 or not validation_dataset_version.strip():
        raise ModelValidationError("validation", "requires four training years, two later holdout years, and a dataset version")
    origin_year, origin_cover = training[-1]
    projected = simulate(_shift(parameters, origin_year), origin_cover, holdout[-1][0] - origin_year)
    by_year = {point.year: point.cover_end_percent for point in projected.annual}
    actual = [cover for _, cover in holdout]
    modeled = [by_year[year] for year, _ in holdout]
    intervals = None
    if prediction_intervals is not None:
        if any(year not in prediction_intervals or prediction_intervals[year][0] > prediction_intervals[year][1]
               for year, _ in holdout):
            raise ModelValidationError("predictionIntervals", "all holdout years need valid lower and upper bounds")
        intervals = [prediction_intervals[year] for year, _ in holdout]
    mean_training = sum(cover for _, cover in training) / len(training)
    baselines = {
        "historicalMean": [mean_training for _ in holdout],
        "lastValue": [origin_cover for _ in holdout],
        "linearTrend": [_linear_trend(training, year) for year, _ in holdout],
    }
    rolling_actual: list[float] = []
    rolling_predicted: list[float] = []
    for index in range(3, len(training)):
        previous_year, previous_cover = training[index - 1]
        next_year, next_cover = training[index]
        one_step = simulate(_shift(parameters, previous_year), previous_cover, next_year - previous_year)
        rolling_actual.append(next_cover)
        rolling_predicted.append(one_step.final_cover_percent)
    return {
        "validationDatasetVersion": validation_dataset_version,
        "trainThroughYear": origin_year,
        "holdoutYears": [year for year, _ in holdout],
        "model": _metrics(actual, modeled, intervals),
        "baselines": {name: _metrics(actual, values) for name, values in baselines.items()},
        "rollingOriginTrainingOnly": _metrics(rolling_actual, rolling_predicted),
        "validationStatus": "independent-holdout-metrics-computed; scientific review required",
        "intervalNote": "Coverage is null when no independently calibrated prediction interval is supplied.",
    }


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def fit_alpha_beta_g(
    parameters: ModelParameters,
    coral_training: Iterable[Observation],
    tourism_training: Iterable[Observation],
    train_end_year: int,
    training_dataset_version: str,
    bootstrap_samples: int = 20,
    seed: int = 1,
) -> dict[str, object]:
    """Bounded nonlinear least squares on training years only.

    g is estimated from the cited annual arrivals driver; alpha and beta are
    fitted jointly to cover using the full nonlinear solver. This is an
    exploratory fit, not a paper value or validation result.
    """
    cover = _series(coral_training, "coralTraining", 6)
    arrivals = _series(tourism_training, "tourismTraining", 4)
    if not training_dataset_version.strip() or any(year > train_end_year for year, _ in cover + arrivals):
        raise ModelValidationError("training", "all fitting observations must be in the named training dataset and on or before the split year")
    if cover[0][0] != parameters.baseline_year or any(value < 0 or value > 100 for _, value in cover):
        raise ModelValidationError("coralTraining", "first year must match model baseline and cover must be 0-100")
    if any(value <= 0 for _, value in arrivals):
        raise ModelValidationError("tourismTraining", "annual arrivals must be positive")
    if max(parameters.temperature(year - parameters.baseline_year) for year, _ in cover) <= parameters.tcrit:
        raise ModelValidationError("alpha", "thermal stress is inactive in training; alpha cannot be identified")
    mean_year = sum(year for year, _ in arrivals) / len(arrivals)
    mean_log = sum(math.log(value) for _, value in arrivals) / len(arrivals)
    denominator = sum((year - mean_year) ** 2 for year, _ in arrivals)
    g = sum((year - mean_year) * (math.log(value) - mean_log) for year, value in arrivals) / denominator
    if not -0.5 <= g <= 0.5:
        raise ModelValidationError("g", "tourism trend is outside the supported bounds")

    def fit_cover(observed: list[Observation]) -> tuple[float, float, list[float]]:
        first_cover = observed[0][1]
        years = [year for year, _ in observed[1:]]
        def scores(alpha: float, beta_scaled: float) -> tuple[float, list[float]]:
            candidate = replace(parameters, alpha=alpha, beta=beta_scaled * 1e-6, g=g)
            try:
                run = simulate(candidate, first_cover, years[-1] - parameters.baseline_year)
            except ModelValidationError:
                return math.inf, []
            by_year = {point.year: point.cover_end_percent for point in run.annual}
            predictions = [by_year[year] for year in years]
            return sum((pred - truth) ** 2 for pred, (_, truth) in zip(predictions, observed[1:])), predictions
        alpha = min(0.5, max(0.0, parameters.alpha))
        beta_scaled = min(10.0, max(0.0, parameters.beta * 1e6))
        best, predictions = scores(alpha, beta_scaled)
        alpha_step, beta_step = 0.125, 2.5
        for _ in range(32):
            improved = False
            for next_alpha, next_beta in ((alpha + alpha_step, beta_scaled), (alpha - alpha_step, beta_scaled),
                                          (alpha, beta_scaled + beta_step), (alpha, beta_scaled - beta_step)):
                next_alpha = min(0.5, max(0.0, next_alpha))
                next_beta = min(10.0, max(0.0, next_beta))
                score, candidate_predictions = scores(next_alpha, next_beta)
                if score + 1e-12 < best:
                    alpha, beta_scaled, best, predictions = next_alpha, next_beta, score, candidate_predictions
                    improved = True
            if not improved:
                alpha_step *= 0.5
                beta_step *= 0.5
        return alpha, beta_scaled * 1e-6, predictions

    alpha, beta, fitted = fit_cover(cover)
    residuals = [truth - prediction for (_, truth), prediction in zip(cover[1:], fitted)]
    rng = random.Random(seed)
    draws: dict[str, list[float]] = {"alpha": [], "beta": [], "g": []}
    for _ in range(bootstrap_samples):
        pseudo = [cover[0]] + [(year, min(100.0, max(0.0, prediction + rng.choice(residuals))))
                                  for (year, _), prediction in zip(cover[1:], fitted)]
        sampled_alpha, sampled_beta, _ = fit_cover(pseudo)
        draws["alpha"].append(sampled_alpha)
        draws["beta"].append(sampled_beta)
        tourism_sample = [rng.choice(arrivals) for _ in arrivals]
        sampled_years = [year for year, _ in tourism_sample]
        sampled_mean = sum(sampled_years) / len(sampled_years)
        sampled_denominator = sum((year - sampled_mean) ** 2 for year in sampled_years)
        if sampled_denominator:
            sampled_log = sum(math.log(value) for _, value in tourism_sample) / len(tourism_sample)
            draws["g"].append(sum((year - sampled_mean) * (math.log(value) - sampled_log)
                                  for year, value in tourism_sample) / sampled_denominator)
    if any(len(values) < 3 for values in draws.values()):
        raise ModelValidationError("bootstrap", "too few valid resamples for uncertainty intervals")
    return {
        "trainingDatasetVersion": training_dataset_version,
        "trainThroughYear": train_end_year,
        "fittedValues": {"alpha": alpha, "beta": beta, "g": g},
        "bootstrap95PercentIntervals": {key: [_percentile(values, 0.025), _percentile(values, 0.975)]
                                       for key, values in draws.items()},
        "method": "bounded nonlinear least squares for alpha/beta; log-linear annual-arrivals fit for g; residual/pairs bootstrap",
        "status": "exploratory fitted values, not paper parameters or validated findings",
        "warnings": ["K and other fixed inputs retain their original uncertainty.",
                     "Bootstrap intervals describe fit sampling variation, not structural model uncertainty."],
    }
