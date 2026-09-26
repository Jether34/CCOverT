"""CCOverT coral-cover model service.

``ccover_model.model`` holds the published equation and its RK4 solver,
``ccover_model.parameters`` holds the paper parameters and their provenance,
``ccover_model.schemas`` is the typed service contract, and
``ccover_model.api`` is the internal FastAPI application.
"""

__all__ = ["api", "model", "parameters", "schemas"]
