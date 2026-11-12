"""Fixtures every test in backend/tests sees. The integration tests have their own (tests/integration/conftest.py).

Until 11 November 2026 this file also signed two accounts in to a hosted auth service for tests/test_rls_isolation.py;
those tests now run on the local stack as tests/integration/test_tenancy_isolation.py and nothing here leaves the machine."""
import pytest


@pytest.fixture(autouse=True)
def _fixings_presence_is_not_carried_between_unit_tests(request):
    """settlement/store.py caches a positive presence answer for the process. In a full run the integration tests
    (a real database, the table present) come first, and a unit test's stand-in session would then be read as a
    database with the fixings table. Unit tests start from 'not asked yet'; the integration tests keep the cache."""
    if request.node.get_closest_marker("integration") is not None:
        yield
        return
    from settlement import store
    saved = dict(store._tables)
    store._tables.clear()
    yield
    store._tables.clear()
    store._tables.update(saved)


@pytest.fixture
def monthly_steps(monkeypatch):
    """Currency and digital-asset XVA runs on monthly steps, as they ran until 0.28.0. For tests of a mechanism
    that does not depend on the grid (the margin-period lag, a leg settling inside a package, the capital add-on by
    hand at a monthly date, wrong-way risk against a quadrature) and whose hand figures were worked on monthly
    dates. The grid the app runs (weekly to a year) has its own tests in tests/test_exposure_grid.py."""
    from pricing import fx_xva
    real = fx_xva.exposure_grid
    monkeypatch.setattr(fx_xva, "exposure_grid", lambda t_years, per_year=None: real(t_years, per_year or 12))

