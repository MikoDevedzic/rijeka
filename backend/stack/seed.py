#!/usr/bin/env python3
"""
seed.py — two users, one firm, their entities and counterparties, and the market data every route
needs to price, on a database built by stack/apply.py. Idempotent (every row is an upsert).

  user_a@rijeka.test  USER_A  trader  ADMIN of the firm  (the template account: all market data is hers)
  user_b@rijeka.test  USER_B  trader  MEMBER of the firm (no market data: the tenancy tests' other side)

Market data (user A, valuation date 2026-11-02, fixed quotes written down here; the demo feed's own
builders turn them into the rows the pricer, the XVA engines, the risk, P&L and credit reports and
the Excel replications read):
  USD_SOFR, EUR_ESTR, GBP_SONIA   OIS pillar curves (demo_feed.build_*: fixing + government par + spread)
  USD_SWVOL_ATM                    swaption ATM normal vols (synthetic parametric surface)
  swaption_vol_skew + sabr_params  the skew cells and a beta=0 SABR fit per cell, as the daily tick writes them
  cap_vol_surface                  flat cap vols by tenor and strike spread
  EURUSD/GBPUSD/USDJPY/BTCUSD/ETHUSD/SOLUSD _SPOT, _VOL   spots and ATM/RR25/BF25 surfaces
  BTC/ETH/SOL _FUNDING             flat funding rates
  xva_calibration                  one HW1F row (a, sigma, theta fixed; not a fit)

--minimal   users, profiles, firm, entities and counterparties only: what a self-hosted instance needs
            to sign in and book; market data is then loaded by the desk (docker-compose uses this).

Usage: python stack/seed.py [--database-url URL] [--minimal]
"""
from __future__ import annotations

import os
import sys

# Run as `python stack/<name>.py`, the script directory is sys.path[0] and stack/token.py would shadow the
# standard library's `token` (tokenize imports it). Put backend/ there instead; `python -m stack.<name>` is the
# documented form and needs nothing.
_HERE = os.path.dirname(os.path.abspath(__file__))
if sys.path and os.path.abspath(sys.path[0] or os.getcwd()) == _HERE:
    sys.path[0] = os.path.dirname(_HERE)

import argparse
import json
import uuid
from datetime import date

from stack.apply import database_url

VALUATION_DATE = date(2026, 11, 2)
SOURCE = f"DEMO · stack seed, fixed quotes · as of {VALUATION_DATE.isoformat()}"

USER_A = uuid.UUID("0000000a-0000-4000-8000-0000000000aa")
USER_B = uuid.UUID("0000000b-0000-4000-8000-0000000000bb")
USERS = [(USER_A, "user_a@rijeka.test", "USER.A", "trader", "ADMIN"),
         (USER_B, "user_b@rijeka.test", "USER.B", "trader", "MEMBER")]
FIRM_NAME = "STACK TEST FIRM"
NS = uuid.UUID("6f1b2c3d-0000-4000-8000-0000000057ac")     # namespace for the seed's deterministic ids

# ── the fixed quotes (percent), dated 2026-11-02 ───────────────────────────────────────────────
SOFR = 3.88
UST_PAR = {1 / 12: 3.95, 2 / 12: 3.93, 0.25: 3.90, 4 / 12: 3.88, 0.5: 3.82, 1: 3.70, 2: 3.62, 3: 3.65,
           5: 3.78, 7: 3.95, 10: 4.12, 20: 4.65, 30: 4.72}
ESTR = 2.41
EUR_AAA_PAR = {0.25: 2.10, 0.5: 2.15, 0.75: 2.18, 1: 2.20, 2: 2.30, 3: 2.38, 4: 2.46, 5: 2.55, 6: 2.62, 7: 2.70,
               8: 2.77, 9: 2.84, 10: 2.90, 12: 3.00, 15: 3.10, 20: 3.20, 25: 3.24, 30: 3.25}
BOE = {"SONIA": 3.72, "5Y": 4.05, "10Y": 4.45, "20Y": 5.10}
SPOTS = {"EURUSD": 1.0850, "GBPUSD": 1.2650, "USDJPY": 152.40, "BTCUSD": 108250.0, "ETHUSD": 3850.0, "SOLUSD": 182.0}
FUNDING = {"BTC": 3.0, "ETH": 2.5, "SOL": 4.0}            # % p.a., continuous
HW1F = {"a": 0.045, "sigma_bp": 78.0, "theta": 0.038, "basket_size": 16, "fit_rmse_bp": 3.1}


def did(*parts) -> uuid.UUID:
    return uuid.uuid5(NS, ":".join(str(p) for p in parts))


def seed_people(db, minimal: bool) -> dict:
    from sqlalchemy import text
    from api.routes.demo import DEMO_BANK_LEI, DEMO_BANK_NAME, demo_lei_for
    out: dict = {"users": {}, "firm": None}
    for uid, email, trader, role, _ in USERS:
        db.execute(text("""
            INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
            VALUES (:id, 'authenticated', 'authenticated', :email, '{"provider": "email", "providers": ["email"]}'::jsonb,
                    cast(:meta as jsonb))
            ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, raw_user_meta_data = EXCLUDED.raw_user_meta_data, updated_at = now()"""),
            {"id": uid, "email": email, "meta": json.dumps({"role": role, "email": email})})
        # the sign-up trigger (handle_new_user) makes the profile on first insert; this makes it exact
        db.execute(text("""
            INSERT INTO profiles (id, trader_id, role, email, full_name, is_active)
            VALUES (:id, :tid, :role, :email, :name, true)
            ON CONFLICT (id) DO UPDATE SET trader_id = EXCLUDED.trader_id, role = EXCLUDED.role, email = EXCLUDED.email,
                                           full_name = EXCLUDED.full_name, is_active = true"""),
            {"id": uid, "tid": trader, "role": role, "email": email, "name": trader.replace(".", " ").title()})
    firm_id = did("firm", FIRM_NAME)
    db.execute(text("""
        INSERT INTO firms (id, name, kind, coverage_tier) VALUES (:id, :name, 'DEALER', 'FREE')
        ON CONFLICT (name) DO UPDATE SET kind = 'DEALER'"""), {"id": firm_id, "name": FIRM_NAME})
    firm_id = db.execute(text("SELECT id FROM firms WHERE name = :n"), {"n": FIRM_NAME}).scalar()
    out["firm"] = str(firm_id)
    # the platform firm the messenger's support rooms belong to (the hosted database has it from migration 010);
    # without it every signed-in page's GET /api/chat/rooms is a 500
    db.execute(text("""
        INSERT INTO firms (id, name, kind, coverage_tier) VALUES (:id, 'Rijeka', 'PLATFORM', 'FREE')
        ON CONFLICT (name) DO UPDATE SET kind = 'PLATFORM'"""), {"id": str(uuid.uuid5(NS, "platform-firm"))})
    for uid, email, trader, _role, member_role in USERS:
        db.execute(text("""
            INSERT INTO firm_members (user_id, firm_id, role) VALUES (:u, :f, :r)
            ON CONFLICT (user_id) DO UPDATE SET firm_id = EXCLUDED.firm_id, role = EXCLUDED.role"""),
            {"u": uid, "f": firm_id, "r": member_role})
        own_lei = demo_lei_for(uid)
        db.execute(text("""
            INSERT INTO firm_leis (lei, firm_id, verified) VALUES (:lei, :f, true)
            ON CONFLICT (lei) DO UPDATE SET firm_id = EXCLUDED.firm_id"""), {"lei": own_lei, "f": firm_id})
        own_id, bank_id, cp_id = did("own", uid), did("bank", uid), did("cp", uid)
        db.execute(text("""
            INSERT INTO legal_entities (id, lei, name, short_name, home_currency, jurisdiction, regulatory_regime, simm_version,
                                        im_threshold_m, ois_curve_id, is_own_entity, is_active, created_by, user_id)
            VALUES (:id, :lei, :name, :short, 'USD', 'US', ARRAY['UMR'], '2.6', 50, 'USD_SOFR', true, true, :u, :u)
            ON CONFLICT (user_id, lei) DO UPDATE SET name = EXCLUDED.name, is_active = true"""),
            {"id": own_id, "lei": own_lei, "name": f"{trader} STACK", "short": trader[:12], "u": uid})
        db.execute(text("""
            INSERT INTO legal_entities (id, lei, name, short_name, home_currency, jurisdiction, regulatory_regime, simm_version,
                                        im_threshold_m, ois_curve_id, is_own_entity, is_active, created_by, user_id)
            VALUES (:id, :lei, :name, 'RJK DEMO BANK', 'USD', 'CH', ARRAY['UMR'], '2.6', 50, 'USD_SOFR', false, true, :u, :u)
            ON CONFLICT (user_id, lei) DO UPDATE SET name = EXCLUDED.name, is_active = true"""),
            {"id": bank_id, "lei": DEMO_BANK_LEI, "name": DEMO_BANK_NAME, "u": uid})
        own_id = db.execute(text("SELECT id FROM legal_entities WHERE user_id = :u AND lei = :l"), {"u": uid, "l": own_lei}).scalar()
        bank_id = db.execute(text("SELECT id FROM legal_entities WHERE user_id = :u AND lei = :l"), {"u": uid, "l": DEMO_BANK_LEI}).scalar()
        db.execute(text("""
            INSERT INTO counterparties (id, legal_entity_id, name, isda_agreement, csa_type, csa_currency, csa_threshold_m, csa_mta_k,
                                        discount_curve_id, im_model, is_active, created_by, user_id)
            VALUES (:id, :le, :name, 'ISDA 2002 (demo)', 'VM_IM', 'USD', 0, 500, 'USD_SOFR', 'SIMM', true, :u, :u)
            ON CONFLICT (id) DO UPDATE SET legal_entity_id = EXCLUDED.legal_entity_id, is_active = true"""),
            {"id": cp_id, "le": bank_id, "name": DEMO_BANK_NAME, "u": uid})
        if not minimal:
            firm_node, desk_node, book_node = (str(did("org", uid, k)) for k in ("firm", "desk", "book"))
            for nid, parent, name, kind in ((firm_node, None, f"{trader} STACK", "firm"), (desk_node, firm_node, "RATES", "desk"),
                                            (book_node, desk_node, "G10 RATES", "book")):
                db.execute(text("""
                    INSERT INTO org_nodes (id, parent_id, name, node_type, is_active, sort_order, created_by, user_id)
                    VALUES (:id, :p, :n, :k, true, 0, :u, :u) ON CONFLICT (id) DO NOTHING"""),
                    {"id": nid, "p": parent, "n": name, "k": kind, "u": uid})
        out["users"][email] = {"id": str(uid), "trader_id": trader, "own_entity_id": str(own_id), "own_lei": own_lei,
                               "counterparty_id": str(cp_id), "counterparty_lei": DEMO_BANK_LEI}
    return out


def seed_market_data(db, uid: uuid.UUID) -> dict:
    from sqlalchemy import text
    from market_data import demo_feed as f
    from api.routes.demo_market_data import _upsert_caps, _upsert_skew, _upsert_snapshot
    d = VALUATION_DATE
    counts: dict[str, int] = {}
    curves = {
        "USD_SOFR": f.build_usd_sofr(SOFR, UST_PAR),
        "EUR_ESTR": f.build_eur_estr(ESTR, EUR_AAA_PAR),
        "GBP_SONIA": f.build_gbp_sonia(BOE),
        "USD_SWVOL_ATM": f.build_swvol_atm(),
    }
    for pair in SPOTS:
        curves[f"{pair}_VOL"] = f.build_fx_vols(pair)
    for cid, quotes in curves.items():
        _upsert_snapshot(db, uid, cid, d, quotes, SOURCE)
    counts["snapshots"] = len(curves)
    for pair, px in SPOTS.items():
        _upsert_snapshot(db, uid, f"{pair}_SPOT", d, [{"tenor": "SPOT", "quote_type": "SPOT", "rate": px, "enabled": True}], "IMPORT")
    for asset, pct in FUNDING.items():
        _upsert_snapshot(db, uid, f"{asset}_FUNDING", d, [{"tenor": "FLAT", "quote_type": "FLAT", "rate": pct, "enabled": True}], "MANUAL")
    counts["spots"], counts["funding"] = len(SPOTS), len(FUNDING)
    counts["skew_cells"], counts["sabr_fits"] = _upsert_skew(db, uid, d, f.build_skew_cells(SOURCE))
    counts["cap_rows"] = _upsert_caps(db, uid, f.build_cap_rows(d, f.par_rate_lookup(curves["USD_SOFR"]), SOURCE))
    db.execute(text("""
        INSERT INTO xva_calibration (curve_id, valuation_date, model, a, sigma_bp, theta, basket_size, fit_rmse_bp, fit_details, created_by, user_id)
        VALUES ('USD_SWVOL_ATM', :d, 'HW1F', :a, :s, :t, :n, :r, cast(:fd as jsonb), :u, :u)
        ON CONFLICT (user_id, curve_id, valuation_date, model)
        DO UPDATE SET a = EXCLUDED.a, sigma_bp = EXCLUDED.sigma_bp, theta = EXCLUDED.theta, fit_details = EXCLUDED.fit_details"""),
        {"d": d, "a": HW1F["a"], "s": HW1F["sigma_bp"], "t": HW1F["theta"], "n": HW1F["basket_size"], "r": HW1F["fit_rmse_bp"],
         "fd": json.dumps({"source": "stack seed: fixed parameters, not a fit", "basket": "USD_SWVOL_ATM"}), "u": uid})
    counts["hw1f"] = 1
    return counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--minimal", action="store_true", help="people and counterparties only, no market data")
    args = ap.parse_args(argv)
    url = database_url(args.database_url)
    os.environ["DATABASE_URL"] = url                 # db/session.py reads it at import; set before load_dotenv could
    os.environ.setdefault("SUPABASE_URL", "http://stack.local")
    from db.session import SessionLocal
    db = SessionLocal()
    try:
        people = seed_people(db, args.minimal)
        db.commit()
        print(f"seed: {url}")
        for email, u in people["users"].items():
            print(f"  {email}  id={u['id']}  own entity {u['own_lei']}  counterparty {u['counterparty_id']}")
        print(f"  firm {FIRM_NAME} {people['firm']}")
        if not args.minimal:
            counts = seed_market_data(db, USER_A)
            db.commit()
            print(f"  market data for user_a as of {VALUATION_DATE}: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
        else:
            print("  --minimal: no market data")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
