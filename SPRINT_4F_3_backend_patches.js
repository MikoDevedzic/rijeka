// SPRINT_4F_3_backend_patches.js
// Patches:
//   backend/main.py         — register market_data router, bump version
//   backend/api/routes/pricer.py — auto-load latest snapshot when no quotes provided
// Run from Rijeka root: node SPRINT_4F_3_backend_patches.js

const fs = require('fs');
const path = require('path');
const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

// ── 1. main.py ───────────────────────────────────────────────────────────────
let main = fs.readFileSync(path.join(RIJEKA, 'backend', 'main.py'), 'utf8');

if (!main.includes('market_data')) {
  main = main.replace(
    `from api.routes import (
    curves,
    org,
    legal_entities,
    counterparties,
    trades,
    analyse,
    trade_events,
    trade_legs,
    cashflows,
    pricer,         # Sprint 3D
)`,
    `from api.routes import (
    curves,
    org,
    legal_entities,
    counterparties,
    trades,
    analyse,
    trade_events,
    trade_legs,
    cashflows,
    pricer,         # Sprint 3D
    market_data,    # Sprint 4F
)`
  );

  main = main.replace(
    'app.include_router(pricer.router)',
    'app.include_router(pricer.router)\napp.include_router(market_data.router)'
  );

  main = main.replace('version="0.3.3"', 'version="0.4.0"');
  main = main.replace('"version": "rijeka-api", "version": "0.3.3"', '"version": "0.4.0"');
  main = main.replace(
    'return {"status": "ok", "service": "rijeka-api", "version": "0.3.3"}',
    'return {"status": "ok", "service": "rijeka-api", "version": "0.4.0"}'
  );

  fs.writeFileSync(path.join(RIJEKA, 'backend', 'main.py'), main, 'utf8');
  console.log('✓ main.py patched — market_data router registered, version → 0.4.0');
} else {
  console.log('i main.py already patched');
}

// ── 2. pricer.py — auto-load latest snapshot ─────────────────────────────────
// Add a helper function _build_curve_auto() that queries market_data_snapshots
// when no flat_rate or quotes are provided.
// Inject after the existing imports block.

let pricer = fs.readFileSync(path.join(RIJEKA, 'backend', 'api', 'routes', 'pricer.py'), 'utf8');

if (!pricer.includes('_build_curve_auto')) {

  // Add sqlalchemy text import if not present
  if (!pricer.includes('from sqlalchemy import text')) {
    pricer = pricer.replace(
      'from sqlalchemy.orm import Session',
      'from sqlalchemy import text\nfrom sqlalchemy.orm import Session'
    );
  }

  // Add json import
  if (!pricer.includes('import json')) {
    pricer = pricer.replace(
      'from __future__ import annotations',
      'from __future__ import annotations\nimport json'
    ).replace(
      'from datetime import date',
      'import json\nfrom datetime import date'
    );
    if (!pricer.includes('import json')) {
      pricer = 'import json\n' + pricer;
    }
  }

  // Inject _build_curve_auto after _build_curve
  const autoHelper = `

def _build_curve_auto(ci: CurveInput, valuation_date: date, db: Session) -> Curve:
    """
    Sprint 4F: build a Curve from CurveInput, auto-loading the latest
    market data snapshot from DB when no quotes or flat_rate provided.

    Priority:
      1. quotes[] with >= 2 entries  → bootstrap
      2. flat_rate                   → flat forward
      3. DB latest snapshot          → bootstrap from saved pillars
      4. No data                     → raise ValueError
    """
    valid_quotes = [q for q in (ci.quotes or []) if q.rate is not None]
    if len(valid_quotes) >= 2:
        return bootstrap_from_dicts(valuation_date, [q.dict() for q in valid_quotes])

    if ci.flat_rate is not None:
        return Curve(valuation_date=valuation_date, flat_rate=float(ci.flat_rate))

    # Try DB snapshot
    try:
        result = db.execute(
            text("""
                SELECT quotes FROM market_data_snapshots
                WHERE curve_id = :curve_id
                ORDER BY valuation_date DESC
                LIMIT 1
            """),
            {"curve_id": ci.curve_id}
        )
        row = result.fetchone()
        if row and row.quotes:
            raw = row.quotes if isinstance(row.quotes, list) else json.loads(row.quotes)
            # Convert from market_data format (rate as %) to bootstrap format (rate as decimal)
            db_quotes = [
                {
                    "tenor":           q.get("tenor"),
                    "quote_type":      _map_quote_type(q.get("quote_type", "OIS")),
                    "rate":            float(q.get("rate", 0)) / 100,  # % → decimal
                    "fra_start_tenor": q.get("fra_start_tenor"),
                }
                for q in raw
                if q.get("enabled", True) and q.get("rate") is not None
            ]
            if len(db_quotes) >= 2:
                return bootstrap_from_dicts(valuation_date, db_quotes)
    except Exception:
        pass  # DB lookup failure is non-fatal — fall through to error

    raise ValueError(
        f"Curve '{ci.curve_id}': no quotes, flat_rate, or saved market data found. "
        f"Go to MARKET DATA workspace, enter quotes, and click SAVE."
    )


def _map_quote_type(qt: str) -> str:
    """Map ratesCurves.js instrument type → bootstrap.py quote_type."""
    mapping = {
        "OISDeposit": "DEPOSIT",
        "OIS":        "OIS_SWAP",
        "BASIS":      "IRS",
        "FRA":        "FRA",
        "FUTURES":    "FUTURES",
        "Deposit":    "DEPOSIT",
        "IRS":        "IRS",
    }
    return mapping.get(qt, "OIS_SWAP")

`;

  pricer = pricer.replace(
    '\ndef _require_trader',
    autoHelper + '\ndef _require_trader'
  );

  // Replace _build_curve calls in price_trade and generate_cashflows with _build_curve_auto
  pricer = pricer.replace(
    /curves\[ci\.curve_id\] = _build_curve\(ci, val_date\)/g,
    'curves[ci.curve_id] = _build_curve_auto(ci, val_date, db)'
  );

  fs.writeFileSync(path.join(RIJEKA, 'backend', 'api', 'routes', 'pricer.py'), pricer, 'utf8');
  console.log('✓ pricer.py patched — auto-load from market_data_snapshots');
} else {
  console.log('i pricer.py already has auto-load');
}

console.log('\nDone. Restart backend: uvicorn main:app --reload');
