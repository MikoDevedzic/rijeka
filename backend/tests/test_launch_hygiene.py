"""Launch audit, batch A (2 November 2026): the edges an outside user meets first.

A write by a foreign trade id is "not found"; a trade is created PENDING with its BOOKED event and
cannot be deleted once it has a lifecycle; both create paths derive and check the structure the same
way; ids and dates are validated at the model, not as a 500; the expensive handlers are rate-limited;
Prometheus has a daily allowance; platform-wide numbers need the admin role; the public health body
carries no exception text."""
import contextlib
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

UID = str(uuid.uuid4())
USER = {"sub": UID, "user_metadata": {"role": "trader"}}


class _Q:
    """A query that answers first()/count()/all() with what the test says."""
    def __init__(self, first=None, count=0, rows=None):
        self._first, self._count, self._rows = first, count, rows or []
    def filter(self, *a, **k): return self
    def filter_by(self, **k): return self
    def order_by(self, *a): return self
    def first(self): return self._first
    def count(self): return self._count
    def all(self): return self._rows
    def delete(self, **k): return 0


class _DB:
    def __init__(self, by_model=None, scalar=None):
        self.by_model, self.scalar_value = by_model or {}, scalar
        self.added, self.deleted, self.committed = [], [], False
    def query(self, *cols):
        key = getattr(cols[0], "__name__", None) or getattr(getattr(cols[0], "class_", None), "__name__", None) or getattr(getattr(cols[0], "parent", None), "class_", type("x", (), {"__name__": ""})).__name__
        return self.by_model.get(key, _Q())
    def execute(self, *a, **k):
        class R:
            def __init__(s, v): s.v = v
            def scalar(s): return s.v
            def first(s): return None
            def all(s): return []
        return R(self.scalar_value)
    def add(self, o): self.added.append(o)
    def delete(self, o): self.deleted.append(o)
    def flush(self): pass
    def begin_nested(self): return contextlib.nullcontext()      # the savepoint a generated trade reference is inserted in
    def commit(self): self.committed = True
    def rollback(self): pass
    def refresh(self, o): pass


# ── cashflows: a foreign trade id is not found, nothing is deleted ────────────────────────────

def test_cashflow_bulk_write_refuses_a_trade_that_is_not_the_callers():
    from api.routes import cashflows as C
    body = C.CashflowBulkIn(trade_id=uuid.uuid4(), cashflows=[])
    db = _DB({"Trade": _Q(first=None)})
    with pytest.raises(HTTPException) as e:
        C.write_cashflow_schedule(body, db=db, user=USER)
    assert e.value.status_code == 404 and not db.committed


# ── trades: created PENDING with a BOOKED event; typed ids and dates; delete refuses a lifecycle ──

def _trade_body(**kw):
    base = dict(asset_class="RATES", instrument_type="IR_SWAP", trade_date="2026-11-02", effective_date="2026-11-04",
                maturity_date="2031-11-04", notional=1e7)
    base.update(kw)
    return base


def test_trade_create_model_forces_pending_and_validates_ids_and_dates():
    from api.routes.trades import TradeCreate
    assert TradeCreate(**_trade_body()).status == "PENDING"
    assert TradeCreate(**_trade_body(status="pending")).status == "PENDING"
    with pytest.raises(ValidationError, match="created PENDING"):
        TradeCreate(**_trade_body(status="CONFIRMED"))
    with pytest.raises(ValidationError, match="must be a UUID"):
        TradeCreate(**_trade_body(counterparty_id="not-a-uuid"))
    with pytest.raises(ValidationError, match="ISO date"):
        TradeCreate(**_trade_body(maturity_date="04/11/2031"))


def test_trade_create_writes_the_booked_event():
    from api.routes import trades as T
    db = _DB({"Counterparty": _Q(first=object()), "LegalEntity": _Q(first=object())})
    body = T.TradeCreate(**_trade_body())
    T.create_trade(body, db=db, user=USER)
    kinds = [type(o).__name__ for o in db.added]
    assert kinds == ["Trade", "TradeEvent"] and db.committed
    ev = db.added[1]
    assert ev.event_type == "BOOKED" and ev.trade_id == db.added[0].id and ev.payload["trade"]["status"] == "PENDING"


def test_trade_delete_refuses_a_trade_with_lifecycle_events():
    from api.routes import trades as T
    t = type("Tr", (), {"id": uuid.uuid4(), "status": "PENDING"})()
    db = _DB({"Trade": _Q(first=t), "TradeEvent": _Q(count=1)})
    with pytest.raises(HTTPException) as e:
        T.delete_trade(t.id, db=db, user=USER)
    assert e.value.status_code == 409 and not db.deleted


# ── one structure rule on both create paths; FX_SWAP has no pricer and is not bookable ─────────

def test_structure_rule_is_shared_by_both_create_paths():
    from api.routes.trades import validated_structure, TradeCreate
    from api.routes.booking import BookingRequest
    assert validated_structure("IR_SWAP", None, {}) == "VANILLA"
    assert validated_structure("FX_OPTION", None, {"style": "DIGITAL"}) == "DIGITAL"
    assert validated_structure("CRYPTO_OPTION", "VANILLA", {"style": "BARRIER"}) == "BARRIER"
    with pytest.raises(ValueError, match="does not match"):
        validated_structure("FX_OPTION", "DIGITAL", {"style": "EUROPEAN"})
    fx = dict(asset_class="FX", instrument_type="FX_OPTION", notional=Decimal("1000000"), trade_date=date(2026, 11, 2),
              effective_date=date(2026, 11, 4), maturity_date=date(2027, 11, 4), terms={"style": "TOUCH"}, legs=[])
    assert BookingRequest(**fx).structure == "TOUCH"
    assert TradeCreate(**_trade_body(asset_class="FX", instrument_type="FX_OPTION", terms={"style": "TOUCH"})).structure == "TOUCH"
    with pytest.raises(ValidationError, match="does not match"):
        BookingRequest(**{**fx, "structure": "DIGITAL"})
    with pytest.raises(ValidationError, match="must be a UUID"):
        BookingRequest(**{**fx, "counterparty_id": "nope"})
    with pytest.raises(ValidationError, match="at least one leg"):
        BookingRequest(**{**fx, "instrument_type": "FX_SWAP", "terms": {}})


# ── bounds and limits ─────────────────────────────────────────────────────────────────────────

def test_simulation_request_is_bounded():
    from api.routes.xva import SimulateRequest
    assert SimulateRequest().paths == 2000
    with pytest.raises(ValidationError):
        SimulateRequest(paths=1)
    with pytest.raises(ValidationError):
        SimulateRequest(maturity_y=0)
    assert not hasattr(SimulateRequest(), "trade_id")


def test_expensive_handlers_are_rate_limited():
    import inspect
    from api.routes import xva, ccr, pnl, risk, methodology, analyse, book_brief
    for fn, key in [(xva.currency_xva, "XVA simulation"), (xva.calibrate, "calibration"), (ccr.ccr_report, "counterparty run"),
                    (pnl.run_eod, "end of day"), (risk.metrics, "live risk report"), (risk.risk_report, "live risk report"),
                    (methodology.replication, "Excel replication"), (analyse.analyse, "Prometheus"), (book_brief.brief, "book brief")]:
        src = inspect.getsource(fn)
        assert f'heavy(user, "{key}"' in src, fn.__name__


def test_prometheus_daily_allowance_counts_input_and_output_tokens(monkeypatch):
    from prometheus import agent as A
    A._budget.clear()
    monkeypatch.setattr(A, "DAILY_TOKENS", 1000)
    usage = type("U", (), {"input_tokens": 600, "output_tokens": 300})()
    assert A.tokens_used("acct") == 0
    assert A.charge("acct", usage) == 900 and A.tokens_used("acct") == 900
    assert A.charge("acct", usage) == 1800 and A.tokens_used("acct") >= A.DAILY_TOKENS
    assert A.tokens_used("other") == 0


# ── admin gate on platform-wide numbers ───────────────────────────────────────────────────────

def test_platform_usage_and_csp_reports_need_the_admin_role():
    from api.routes import usage as U, csp as CSP
    trader = _DB(scalar="trader")
    with pytest.raises(HTTPException) as e:
        U.ops_usage(db=trader, user=USER)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        CSP.csp_reports(db=trader, user=USER)
    assert e.value.status_code == 403
    admin = _DB(scalar="admin")
    assert "count" in CSP.csp_reports(db=admin, user=USER)


# ── the public health body: a failed step shows its class, not its message ────────────────────

def test_scheduler_records_the_exception_class_only():
    import scheduler as S
    class Sess:
        def commit(self): pass
        def rollback(self): pass
        def close(self): pass
    def boom(db, secret):
        raise RuntimeError("postgresql://user:secret@host/db failed")
    assert S.run_step("t", boom, "s", session_factory=Sess) is False
    detail = S.status()["steps"]["t"]["detail"]
    assert "RuntimeError" in detail and "postgresql" not in detail and "secret" not in detail


# ── the unified ticket books options through the atomic route ─────────────────────────────────

def test_booking_request_accepts_a_cap_as_one_zero_participation_float_leg_with_embedded_options():
    from api.routes.booking import BookingRequest, LegInput, complete_booking
    leg = LegInput(leg_ref="OPT-1", leg_seq=1, leg_type="FLOAT", direction="RECEIVE", currency="USD",
                   notional=Decimal("10000000"), leverage=Decimal("0"), spread=Decimal("0"),
                   embedded_options=[{"type": "CAP", "direction": "BUY", "default_strike": 0.045,
                                      "strike_schedule": [{"date": "2026-11-04", "strike": 0.045}]}])
    body = BookingRequest(asset_class="RATES", instrument_type="INTEREST_RATE_CAP", notional=Decimal("10000000"),
                          trade_date=date(2026, 11, 2), effective_date=date(2026, 11, 4), maturity_date=date(2031, 11, 4),
                          terms={"option": "CAP", "side": "BUY", "cap_rate": 0.045, "float_index": "SOFR"}, legs=[leg])
    assert body.instrument_type == "IR_CAP" and body.structure is None
    done = complete_booking(body)
    lg = done.legs[0]
    assert float(lg.leverage) == 0 and lg.embedded_options[0]["type"] == "CAP"
    assert lg.effective_date == date(2026, 11, 4) and lg.discount_curve_id == "USD_SOFR" and lg.forecast_curve_id


def test_booking_request_keeps_a_swaptions_forward_starting_underlying():
    from api.routes.booking import BookingRequest, LegInput, complete_booking
    legs = [LegInput(leg_ref="FIXED-1", leg_seq=1, leg_type="FIXED", direction="PAY", currency="USD", notional=Decimal("1e7"),
                     effective_date=date(2027, 11, 4), maturity_date=date(2032, 11, 4), fixed_rate=Decimal("0.0375")),
            LegInput(leg_ref="FLOAT-1", leg_seq=2, leg_type="FLOAT", direction="RECEIVE", currency="USD", notional=Decimal("1e7"),
                     effective_date=date(2027, 11, 4), maturity_date=date(2032, 11, 4), forecast_curve_id="USD_SOFR")]
    body = BookingRequest(asset_class="RATES", instrument_type="IR_SWAPTION", structure="EUROPEAN", notional=Decimal("1e7"),
                          trade_date=date(2026, 11, 2), effective_date=date(2026, 11, 4), maturity_date=date(2032, 11, 4),
                          terms={"option": "SWAPTION", "side": "BUY", "is_payer": True, "expiry_date": "2027-11-04",
                                 "strike": 0.0375, "exercise_type": "EUROPEAN", "direction": "PAY"}, legs=legs)
    done = complete_booking(body)
    assert done.structure == "EUROPEAN"
    assert done.legs[0].effective_date == date(2027, 11, 4), "the underlying keeps its forward start"
    assert float(done.legs[0].fixed_rate) == 0.0375
