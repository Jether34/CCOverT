import unittest

from ccover_model.model import ModelParameters, ModelValidationError, simulate
from ccover_model.validation import evaluate_time_split, fit_alpha_beta_g


class TimeValidationTests(unittest.TestCase):
    def setUp(self):
        self.parameters = ModelParameters.from_mapping({
            "r": 0.028, "alpha": 0.01, "beta": 5e-8, "gamma": 0.01,
            "T0": 31.3, "Tcrit": 31, "V0": 100000, "g": 0.02,
            "K": 70, "baselineYear": 2006,
        })
        result = simulate(self.parameters, 55.0, 8)
        self.cover = [(2006, 55.0)] + [(point.year, point.cover_end_percent) for point in result.annual]
        self.arrivals = [(year, self.parameters.tourism(year - 2006)) for year in range(2006, 2015)]

    def test_fitting_uses_training_years_only_and_labels_estimates(self):
        fitted = fit_alpha_beta_g(
            self.parameters, self.cover[:7], self.arrivals[:7], 2012, "training-v1", bootstrap_samples=5, seed=7
        )
        self.assertEqual(fitted["trainThroughYear"], 2012)
        self.assertAlmostEqual(fitted["fittedValues"]["g"], 0.02, places=5)
        self.assertIn("not paper parameters", fitted["status"])
        self.assertEqual(len(fitted["bootstrap95PercentIntervals"]["alpha"]), 2)
        with self.assertRaises(ModelValidationError):
            fit_alpha_beta_g(self.parameters, self.cover, self.arrivals, 2012, "training-v1", bootstrap_samples=5)

    def test_holdout_and_rolling_metrics_are_reproducible(self):
        first = evaluate_time_split(self.parameters, self.cover, 2012, "validation-v1")
        second = evaluate_time_split(self.parameters, self.cover, 2012, "validation-v1")
        self.assertEqual(first, second)
        self.assertEqual(first["holdoutYears"], [2013, 2014])
        self.assertLess(first["model"]["mae"], 1e-8)
        self.assertIsNone(first["model"]["predictionIntervalCoverage"])
        bounded = evaluate_time_split(self.parameters, self.cover, 2012, "validation-v1", {2013: (0, 100), 2014: (0, 100)})
        self.assertEqual(bounded["model"]["predictionIntervalCoverage"], 1.0)
        self.assertEqual(set(first["baselines"]), {"historicalMean", "lastValue", "linearTrend"})
        self.assertIn("scientific review required", first["validationStatus"])

    def test_holdout_requires_independent_years(self):
        with self.assertRaises(ModelValidationError):
            evaluate_time_split(self.parameters, self.cover[:7], 2012, "validation-v1")


if __name__ == "__main__":
    unittest.main()
