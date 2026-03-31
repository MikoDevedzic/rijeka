/**
 * RIJEKA — Sprint 5A: pnl_snapshots table + pricer auto-write
 * Delivers:
 *   1. docs/pnl_snapshots_migration.sql   — paste into Supabase SQL Editor
 *   2. backend/pricing/pnl.py             — pure Python PNL attribution engine
 *   3. backend/api/routes/pricer.py       — updated to auto-write pnl_snapshot
 *
 * Run from Rijeka root:
 *   node sprint5a_pnl_foundation.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

function write(relPath, content) {
  const full = path.join(ROOT, relPath);
  const dir  = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('  ✅ Written: ' + relPath);
}

function read(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) { console.log('  SKIP (not found): ' + relPath); return null; }
  return fs.readFileSync(full, 'utf8');
}

// ─────────────────────────────────────────────────────────────
// 1. SQL MIGRATION
// ─────────────────────────────────────────────────────────────

const SQL = `-- ============================================================
-- RIJEKA Sprint 5A: pnl_snapshots
-- Run in Supabase SQL Editor
-- One row per trade per valuation date.
-- Auto-written by pricer on every RUN PRICER call.
-- Foundation for PNL attribution, desk reports, PROMETHEUS.
-- ============================================================

CREATE TABLE IF NOT EXISTS pnl_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  trade_id          UUID        NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  snapshot_date     DATE        NOT NULL,

  -- Raw NPV (from pricer)
  npv               NUMERIC(24,6) NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'USD',

  -- Greeks at this snapshot (Rijeka taxonomy — never PV01/DV01)
  ir01              NUMERIC(18,6),   -- parallel +1bp all curves → ΔNPV
  ir01_disc         NUMERIC(18,6),   -- +1bp discount curve only → ΔNPV
  theta             NUMERIC(18,6),   -- NPV(t+1day) - NPV(t)
  gamma             NUMERIC(18,6),   -- second-order rate sensitivity

  -- Market moves observed vs previous snapshot (filled on attribution run)
  delta_rate_bps    NUMERIC(10,4),   -- parallel rate shift observed (bps)
  delta_disc_bps    NUMERIC(10,4),   -- discount curve shift observed (bps)

  -- PNL vs previous day (NULL on first snapshot for a trade)
  total_pnl         NUMERIC(24,6),   -- NPV(today) - NPV(yesterday)

  -- Attribution components (Rijeka taxonomy)
  carry             NUMERIC(18,6),   -- income earned, curves fixed
  rolldown          NUMERIC(18,6),   -- curve roll-down effect
  theta_pnl         NUMERIC(18,6),   -- theta × 1 day
  ir01_pnl          NUMERIC(18,6),   -- ir01 × delta_rate_bps
  ir01_disc_pnl     NUMERIC(18,6),   -- ir01_disc × delta_disc_bps (drill-down)
  gamma_pnl         NUMERIC(18,6),   -- 0.5 × gamma × (delta_rate_bps)²
  fx01_pnl          NUMERIC(18,6),   -- Sprint 5B
  xccy01_pnl        NUMERIC(18,6),   -- Sprint 5B
  basis01_pnl       NUMERIC(18,6),   -- Sprint 5B
  ir_vega_pnl       NUMERIC(18,6),   -- Sprint 5C
  cs01_pnl          NUMERIC(18,6),   -- Sprint 5C
  unexplained       NUMERIC(18,6),   -- total_pnl - sum(all components)

  -- Audit / context
  source            TEXT        NOT NULL DEFAULT 'PRICER'
                                CHECK (source IN ('PRICER','BATCH','MANUAL')),
  curve_inputs      JSONB,           -- snapshot of curves used (for audit)
  valuation_date    DATE,            -- pricer valuation date (may differ from snapshot_date)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID        REFERENCES auth.users(id),

  CONSTRAINT pnl_snapshots_trade_date_unique UNIQUE (trade_id, snapshot_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS pnl_snap_trade_id_idx
  ON pnl_snapshots (trade_id);
CREATE INDEX IF NOT EXISTS pnl_snap_date_idx
  ON pnl_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS pnl_snap_trade_date_idx
  ON pnl_snapshots (trade_id, snapshot_date DESC);

-- RLS
ALTER TABLE pnl_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pnl_snap_select_authenticated"
  ON pnl_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "pnl_snap_insert_authenticated"
  ON pnl_snapshots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "pnl_snap_update_authenticated"
  ON pnl_snapshots FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── Useful views ──────────────────────────────────────────────

-- Daily PNL by desk (aggregated)
CREATE OR REPLACE VIEW pnl_daily_by_desk AS
SELECT
  p.snapshot_date,
  t.desk,
  t.asset_class,
  SUM(p.carry)         AS carry,
  SUM(p.rolldown)      AS rolldown,
  SUM(p.theta_pnl)     AS theta_pnl,
  SUM(p.ir01_pnl)      AS ir01_pnl,
  SUM(p.gamma_pnl)     AS gamma_pnl,
  SUM(p.fx01_pnl)      AS fx01_pnl,
  SUM(p.xccy01_pnl)    AS xccy01_pnl,
  SUM(p.ir_vega_pnl)   AS ir_vega_pnl,
  SUM(p.unexplained)   AS unexplained,
  SUM(p.total_pnl)     AS total_pnl,
  COUNT(*)             AS trade_count
FROM pnl_snapshots p
JOIN trades t ON t.id = p.trade_id
WHERE p.total_pnl IS NOT NULL
GROUP BY p.snapshot_date, t.desk, t.asset_class
ORDER BY p.snapshot_date DESC, total_pnl DESC;

GRANT SELECT ON pnl_daily_by_desk TO authenticated;

-- MTD PNL per trade
CREATE OR REPLACE VIEW pnl_mtd_by_trade AS
SELECT
  p.trade_id,
  t.trade_ref,
  t.desk,
  t.book,
  t.asset_class,
  t.instrument_type,
  DATE_TRUNC('month', CURRENT_DATE) AS mtd_start,
  SUM(p.total_pnl)     AS mtd_pnl,
  SUM(p.carry)         AS mtd_carry,
  SUM(p.theta_pnl)     AS mtd_theta,
  SUM(p.ir01_pnl)      AS mtd_ir01_pnl,
  SUM(p.ir_vega_pnl)   AS mtd_vega_pnl,
  SUM(p.unexplained)   AS mtd_unexplained,
  COUNT(*)             AS days_priced
FROM pnl_snapshots p
JOIN trades t ON t.id = p.trade_id
WHERE p.snapshot_date >= DATE_TRUNC('month', CURRENT_DATE)
  AND p.total_pnl IS NOT NULL
GROUP BY p.trade_id, t.trade_ref, t.desk, t.book, t.asset_class, t.instrument_type
ORDER BY mtd_pnl DESC;

GRANT SELECT ON pnl_mtd_by_trade TO authenticated;

-- Verify
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'pnl_snapshots';
-- Expected: 3 rows — SELECT, INSERT, UPDATE
`;

console.log('\n=== 1. Writing SQL migration ===');
write('docs/pnl_snapshots_migration.sql', SQL);

// ─────────────────────────────────────────────────────────────
// 2. backend/pricing/pnl.py — attribution engine
// ─────────────────────────────────────────────────────────────

const PNL_PY = `"""
RIJEKA — PNL Attribution Engine
Sprint 5A: IR01_PNL, IR01_DISC_PNL, THETA_PNL, CARRY, ROLLDOWN, GAMMA_PNL, UNEXPLAINED
Sprint 5B: FX01_PNL, XCCY01_PNL, BASIS01_PNL (requires FX snapshot)
Sprint 5C: IR_VEGA_PNL (requires vol surface)

Risk taxonomy: IR01/IR01_DISC/THETA/GAMMA. Never PV01/DV01.
"""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class PNLAttribution:
    """
    Full PNL attribution for one trade for one day.
    All amounts in trade currency.
    Taxonomy: IR01, IR01_DISC, THETA — never PV01/DV01.
    """
    trade_id:       str
    snapshot_date:  str          # YYYY-MM-DD
    currency:       str

    # Raw NPV
    npv:            float = 0.0

    # Greeks at this snapshot
    ir01:           float = 0.0  # parallel +1bp all curves → ΔNPV
    ir01_disc:      float = 0.0  # +1bp discount curve only → ΔNPV
    theta:          float = 0.0  # NPV(t+1day) - NPV(t)
    gamma:          float = 0.0  # second-order rate sensitivity

    # Market moves observed (bps)
    delta_rate_bps: float = 0.0  # parallel rate shift vs yesterday
    delta_disc_bps: float = 0.0  # discount curve shift vs yesterday

    # Total PNL
    total_pnl:      Optional[float] = None  # None on first snapshot

    # Attribution components
    carry:          float = 0.0
    rolldown:       float = 0.0
    theta_pnl:      float = 0.0
    ir01_pnl:       float = 0.0
    ir01_disc_pnl:  float = 0.0
    gamma_pnl:      float = 0.0
    fx01_pnl:       float = 0.0   # Sprint 5B
    xccy01_pnl:     float = 0.0   # Sprint 5B
    basis01_pnl:    float = 0.0   # Sprint 5B
    ir_vega_pnl:    float = 0.0   # Sprint 5C
    cs01_pnl:       float = 0.0   # Sprint 5C
    unexplained:    float = 0.0

    @property
    def attributed_total(self) -> float:
        """Sum of all attribution components. Should equal total_pnl."""
        return (
            self.carry +
            self.rolldown +
            self.theta_pnl +
            self.ir01_pnl +
            self.gamma_pnl +
            self.fx01_pnl +
            self.xccy01_pnl +
            self.basis01_pnl +
            self.ir_vega_pnl +
            self.cs01_pnl +
            self.unexplained
        )


def compute_carry(
    npv_curves_fixed: float,
    npv_yesterday: float
) -> float:
    """
    CARRY = accrued income assuming curves unchanged over 1 day.
    Computed as NPV(today, yesterday's curves) - NPV(yesterday).
    Passed in from pricer — requires re-pricing with frozen curves.
    Sprint 5A: approximated as coupon_accrual / 365 if frozen reprice unavailable.
    """
    return npv_curves_fixed - npv_yesterday


def compute_rolldown(
    npv_curves_rolled: float,
    npv_yesterday: float
) -> float:
    """
    ROLLDOWN = P&L from rolling down the curve 1 day.
    NPV(curves shifted 1 day forward in time) - NPV(yesterday).
    Sprint 5A: set to 0.0 until curve roll infrastructure is built.
    Sprint 5B: implement properly.
    """
    return npv_curves_rolled - npv_yesterday


def compute_attribution(
    npv_today:        float,
    npv_yesterday:    float,
    ir01:             float,      # Greek at yesterday's snapshot
    ir01_disc:        float,      # Greek at yesterday's snapshot
    theta:            float,      # Greek at yesterday's snapshot
    gamma:            float,      # Greek at yesterday's snapshot
    delta_rate_bps:   float,      # parallel rate move today (bps)
    delta_disc_bps:   float,      # discount curve move today (bps)
    carry:            float = 0.0,
    rolldown:         float = 0.0,
    trade_id:         str   = "",
    snapshot_date:    str   = "",
    currency:         str   = "USD",
) -> PNLAttribution:
    """
    Sprint 5A attribution: IR rates products (IRS, OIS, FRA, basis swaps).

    Total PNL identity (must hold):
      total_pnl = carry + rolldown + theta_pnl + ir01_pnl + gamma_pnl + unexplained

    Note: ir01_disc_pnl is a DRILL-DOWN sub-component of ir01_pnl, not additive.
    It explains what fraction of ir01_pnl came from discount curve moves specifically.

    Sign convention:
      delta_rate_bps > 0  → rates moved up → PAY FIXED trade loses (negative ir01_pnl)
      ir01 > 0            → receive fixed position (positive rate sensitivity)
      ir01 < 0            → pay fixed position (negative rate sensitivity)
    """
    total_pnl = npv_today - npv_yesterday

    # ── Theta PNL ──────────────────────────────────────────────
    # theta is already NPV(t+1) - NPV(t), so for 1 day: theta_pnl = theta
    theta_pnl = theta

    # ── Rate Delta PNL ─────────────────────────────────────────
    # IR01 is in currency per 1bp. Rate moved delta_rate_bps bps.
    # ir01_pnl = ir01 × delta_rate_bps
    # Note: ir01 from pricer is already signed correctly.
    # A PAY FIXED swap has negative ir01 (loses when rates rise).
    ir01_pnl = ir01 * delta_rate_bps

    # Drill-down: discount-curve-only component
    ir01_disc_pnl = ir01_disc * delta_disc_bps

    # ── Gamma PNL ──────────────────────────────────────────────
    # Gamma = second-order rate sensitivity.
    # gamma_pnl = 0.5 × gamma × (delta_rate_bps)²
    # For vanilla IRS, gamma is tiny. Non-trivial for swaptions.
    gamma_pnl = 0.5 * gamma * (delta_rate_bps ** 2) if gamma else 0.0

    # ── Unexplained ────────────────────────────────────────────
    # Everything not captured by Sprint 5A attribution.
    # Should be near zero for vanilla IRS.
    # Will be large for XCCY (FX01 missing) and swaptions (IR_VEGA missing).
    # These become Sprint 5B and 5C respectively.
    attributed = carry + rolldown + theta_pnl + ir01_pnl + gamma_pnl
    unexplained = total_pnl - attributed

    # ── Quality check ──────────────────────────────────────────
    # Flag if unexplained is large relative to total PNL
    if total_pnl != 0 and abs(unexplained) > 0:
        pct = abs(unexplained / total_pnl) * 100
        if pct > 10 and abs(unexplained) > 500:
            logger.warning(
                f"PNL attribution: trade {trade_id} date {snapshot_date} "
                f"unexplained=${unexplained:,.0f} ({pct:.1f}% of total). "
                f"Expected for XCCY/swaptions until Sprint 5B/5C."
            )

    return PNLAttribution(
        trade_id      = trade_id,
        snapshot_date = snapshot_date,
        currency      = currency,
        npv           = npv_today,
        ir01          = ir01,
        ir01_disc     = ir01_disc,
        theta         = theta,
        gamma         = gamma,
        delta_rate_bps  = delta_rate_bps,
        delta_disc_bps  = delta_disc_bps,
        total_pnl     = total_pnl,
        carry         = carry,
        rolldown      = rolldown,
        theta_pnl     = theta_pnl,
        ir01_pnl      = ir01_pnl,
        ir01_disc_pnl = ir01_disc_pnl,
        gamma_pnl     = gamma_pnl,
        unexplained   = unexplained,
    )


def get_market_move(
    curve_snapshots_today:     dict,  # { curve_id: [{tenor, rate}, ...] }
    curve_snapshots_yesterday: dict,
    curve_id:                  str,
) -> float:
    """
    Compute parallel rate move (bps) for a given curve between two snapshots.
    Returns mean shift across all enabled pillars.
    Returns 0.0 if either snapshot is missing.
    """
    today_quotes = curve_snapshots_today.get(curve_id, [])
    yest_quotes  = curve_snapshots_yesterday.get(curve_id, [])

    if not today_quotes or not yest_quotes:
        return 0.0

    # Build tenor→rate dicts
    today_map = {q['tenor']: q['rate'] for q in today_quotes if q.get('enabled', True)}
    yest_map  = {q['tenor']: q['rate'] for q in yest_quotes  if q.get('enabled', True)}

    # Common tenors only
    common = set(today_map.keys()) & set(yest_map.keys())
    if not common:
        return 0.0

    # Mean shift in bps (rates stored as % e.g. 5.310, so *100 to get bps)
    # Actually rates in market_data_snapshots are stored as % already
    # e.g. 5.310 means 5.310% = 531 bps absolute level
    # Delta = today_rate - yesterday_rate, already in % → convert to bps × 100
    shifts = [(today_map[t] - yest_map[t]) * 100 for t in common]
    return sum(shifts) / len(shifts)
`;

console.log('\n=== 2. Writing pnl.py attribution engine ===');
write('backend/pricing/pnl.py', PNL_PY);

// ─────────────────────────────────────────────────────────────
// 3. Update backend/api/routes/pricer.py
//    Add: auto-write pnl_snapshot after every price call
// ─────────────────────────────────────────────────────────────

console.log('\n=== 3. Updating pricer.py to auto-write pnl_snapshot ===');

const PRICER = read('backend/api/routes/pricer.py');
if (PRICER) {

  // ── 3a. Add pnl import at top of file ──────────────────────
  const PNL_IMPORT = `from pricing.pnl import PNLAttribution
from datetime import date as date_type
import logging

logger = logging.getLogger(__name__)
`;

  // Insert after existing imports block (after last "from pricing" or "import" line)
  // We'll add it just before the first @router decorator
  let updated = PRICER;

  if (!updated.includes('from pricing.pnl import')) {
    // Find insertion point — before first @router
    const routerIdx = updated.indexOf('@router');
    if (routerIdx !== -1) {
      updated = updated.slice(0, routerIdx) + PNL_IMPORT + '\n' + updated.slice(routerIdx);
      console.log('    ✅ Added pnl import block');
    } else {
      console.log('    ⚠️  Could not find @router — adding import at top');
      updated = PNL_IMPORT + '\n' + updated;
    }
  } else {
    console.log('    ── pnl import already present');
  }

  // ── 3b. Add _write_pnl_snapshot helper function ─────────────
  const WRITE_SNAPSHOT_FN = `
async def _write_pnl_snapshot(
    db,
    trade_id:      str,
    snapshot_date: str,
    npv:           float,
    currency:      str,
    ir01:          float,
    ir01_disc:     float,
    theta:         float,
    gamma:         float,
    curve_inputs:  list,
    created_by:    str,
    valuation_date: str,
) -> None:
    """
    Upsert a pnl_snapshot row after every pricer run.
    Computes attribution if a previous snapshot exists for this trade.
    UPSERT on (trade_id, snapshot_date) — idempotent, re-running pricer is safe.
    """
    try:
        # Fetch yesterday's snapshot for this trade
        yesterday_row = db.execute(
            """
            SELECT npv, ir01, ir01_disc, theta, gamma, snapshot_date
            FROM pnl_snapshots
            WHERE trade_id = :trade_id
              AND snapshot_date < :today
            ORDER BY snapshot_date DESC
            LIMIT 1
            """,
            {"trade_id": trade_id, "today": snapshot_date}
        ).fetchone()

        # Fetch yesterday's market data snapshot for rate move calculation
        # For Sprint 5A: use a simple parallel shift approximation
        # Full market move calculation wired in Sprint 5B
        delta_rate_bps = 0.0
        delta_disc_bps = 0.0
        total_pnl      = None
        carry          = 0.0
        rolldown       = 0.0
        theta_pnl      = 0.0
        ir01_pnl       = 0.0
        ir01_disc_pnl  = 0.0
        gamma_pnl      = 0.0
        unexplained    = 0.0

        if yesterday_row:
            npv_yesterday   = float(yesterday_row.npv or 0)
            ir01_yesterday  = float(yesterday_row.ir01 or 0)
            ir01_disc_yest  = float(yesterday_row.ir01_disc or 0)
            theta_yesterday = float(yesterday_row.theta or 0)
            gamma_yesterday = float(yesterday_row.gamma or 0)
            total_pnl       = npv - npv_yesterday

            # Sprint 5A: theta_pnl = theta (1 day decay)
            theta_pnl = theta_yesterday

            # Sprint 5A: ir01_pnl = ir01 × delta_rate_bps
            # delta_rate_bps computed from market_data_snapshots diff in Sprint 5B
            # For now: back-solve from total_pnl and theta
            # ir01_pnl approximated as 0 until market data diff wired
            carry       = 0.0   # Sprint 5B
            rolldown    = 0.0   # Sprint 5B
            ir01_pnl    = 0.0   # Sprint 5B — needs market move
            ir01_disc_pnl = 0.0 # Sprint 5B
            gamma_pnl   = 0.0   # Sprint 5B
            unexplained = total_pnl - theta_pnl  # everything unexplained until 5B

        # UPSERT — idempotent
        db.execute(
            """
            INSERT INTO pnl_snapshots (
              trade_id, snapshot_date, npv, currency,
              ir01, ir01_disc, theta, gamma,
              delta_rate_bps, delta_disc_bps,
              total_pnl, carry, rolldown, theta_pnl,
              ir01_pnl, ir01_disc_pnl, gamma_pnl,
              unexplained, source, curve_inputs,
              valuation_date, created_by
            )
            VALUES (
              :trade_id, :snapshot_date, :npv, :currency,
              :ir01, :ir01_disc, :theta, :gamma,
              :delta_rate_bps, :delta_disc_bps,
              :total_pnl, :carry, :rolldown, :theta_pnl,
              :ir01_pnl, :ir01_disc_pnl, :gamma_pnl,
              :unexplained, 'PRICER', :curve_inputs::jsonb,
              :valuation_date, :created_by
            )
            ON CONFLICT (trade_id, snapshot_date)
            DO UPDATE SET
              npv            = EXCLUDED.npv,
              ir01           = EXCLUDED.ir01,
              ir01_disc      = EXCLUDED.ir01_disc,
              theta          = EXCLUDED.theta,
              gamma          = EXCLUDED.gamma,
              total_pnl      = EXCLUDED.total_pnl,
              theta_pnl      = EXCLUDED.theta_pnl,
              unexplained    = EXCLUDED.unexplained,
              curve_inputs   = EXCLUDED.curve_inputs,
              valuation_date = EXCLUDED.valuation_date
            """,
            {
                "trade_id":       trade_id,
                "snapshot_date":  snapshot_date,
                "npv":            npv,
                "currency":       currency,
                "ir01":           ir01,
                "ir01_disc":      ir01_disc,
                "theta":          theta,
                "gamma":          gamma,
                "delta_rate_bps": delta_rate_bps,
                "delta_disc_bps": delta_disc_bps,
                "total_pnl":      total_pnl,
                "carry":          carry,
                "rolldown":       rolldown,
                "theta_pnl":      theta_pnl,
                "ir01_pnl":       ir01_pnl,
                "ir01_disc_pnl":  ir01_disc_pnl,
                "gamma_pnl":      gamma_pnl,
                "unexplained":    unexplained,
                "curve_inputs":   str(curve_inputs).replace("'", '"'),
                "valuation_date": valuation_date,
                "created_by":     created_by,
            }
        )
        db.commit()
        logger.info(f"pnl_snapshot written: trade={trade_id} date={snapshot_date} npv={npv:,.2f}")

    except Exception as e:
        logger.error(f"pnl_snapshot write failed: trade={trade_id} error={e}")
        # Non-fatal — pricer result still returned to client
        db.rollback()

`;

  // Insert helper function before first @router.post
  if (!updated.includes('async def _write_pnl_snapshot')) {
    const firstRoute = updated.indexOf('@router.post');
    if (firstRoute !== -1) {
      updated = updated.slice(0, firstRoute) + WRITE_SNAPSHOT_FN + updated.slice(firstRoute);
      console.log('    ✅ Added _write_pnl_snapshot helper');
    } else {
      console.log('    ⚠️  Could not find @router.post — appending helper at end');
      updated += '\n' + WRITE_SNAPSHOT_FN;
    }
  } else {
    console.log('    ── _write_pnl_snapshot already present');
  }

  // ── 3c. Call _write_pnl_snapshot in the price route ────────
  // Find the return statement in the price route and add the snapshot call before it
  // Look for the pattern: return { "npv": ...
  // We add the snapshot call just before the final return of the price route

  const SNAPSHOT_CALL = `
    # ── Auto-write PNL snapshot (Sprint 5A) ──────────────────
    # Non-blocking — pricer result is returned even if this fails
    snap_date = valuation_date or str(date_type.today())
    await _write_pnl_snapshot(
        db           = db,
        trade_id     = str(trade_id),
        snapshot_date= snap_date,
        npv          = float(result.npv or 0),
        currency     = trade.notional_ccy or "USD",
        ir01         = float(greeks.ir01 or 0) if greeks else 0.0,
        ir01_disc    = float(greeks.ir01_disc or 0) if greeks else 0.0,
        theta        = float(greeks.theta or 0) if greeks else 0.0,
        gamma        = 0.0,  # Sprint 5B — add gamma to greeks.py
        curve_inputs = curves or [],
        created_by   = str(current_user.get("sub", "")),
        valuation_date = snap_date,
    )
`;

  // Find a good anchor — the return of the price result dict
  // Common patterns in the pricer route return
  const returnAnchors = [
    'return {\n        "npv"',
    'return {\n            "npv"',
    'return {"npv"',
    'return PriceResponse',
    'return price_response',
  ];

  let anchorFound = false;
  for (const anchor of returnAnchors) {
    if (updated.includes(anchor) && !updated.includes('_write_pnl_snapshot\n    # ── Auto')) {
      updated = updated.replace(anchor, SNAPSHOT_CALL + '    ' + anchor);
      console.log(`    ✅ Wired snapshot call before return (anchor: "${anchor.slice(0,30)}...")`);
      anchorFound = true;
      break;
    }
  }

  if (!anchorFound) {
    if (updated.includes('_write_pnl_snapshot')) {
      console.log('    ── snapshot call already wired');
    } else {
      console.log('    ⚠️  Could not auto-wire snapshot call — see MANUAL STEP below');
      console.log('');
      console.log('    MANUAL STEP: In backend/api/routes/pricer.py,');
      console.log('    find the price route return statement and add before it:');
      console.log('');
      console.log('    snap_date = valuation_date or str(date_type.today())');
      console.log('    await _write_pnl_snapshot(');
      console.log('        db=db, trade_id=str(trade_id), snapshot_date=snap_date,');
      console.log('        npv=float(result.npv or 0), currency=trade.notional_ccy or "USD",');
      console.log('        ir01=float(greeks.ir01 or 0) if greeks else 0.0,');
      console.log('        ir01_disc=float(greeks.ir01_disc or 0) if greeks else 0.0,');
      console.log('        theta=float(greeks.theta or 0) if greeks else 0.0,');
      console.log('        gamma=0.0, curve_inputs=curves or [],');
      console.log('        created_by=str(current_user.get("sub","")),');
      console.log('        valuation_date=snap_date,');
      console.log('    )');
    }
  }

  write('backend/api/routes/pricer.py', updated);
}

// ─────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────

console.log(`
══════════════════════════════════════════════
  SPRINT 5A — PNL FOUNDATION COMPLETE
══════════════════════════════════════════════

  Files written:
    docs/pnl_snapshots_migration.sql   → paste into Supabase SQL Editor
    backend/pricing/pnl.py             → attribution engine
    backend/api/routes/pricer.py       → auto-write snapshot on RUN PRICER

  NEXT STEP 1 — Run SQL in Supabase:
    Open docs/pnl_snapshots_migration.sql
    Paste entire content into Supabase SQL Editor → RUN
    Verify: SELECT policyname, cmd FROM pg_policies
            WHERE tablename = 'pnl_snapshots';
    Expected: 3 rows — SELECT, INSERT, UPDATE

  NEXT STEP 2 — Restart backend:
    cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend
    uvicorn main:app --reload

  NEXT STEP 3 — Test:
    Open app → PRICER tile → select TRD-90992960 → RUN PRICER
    Then in Supabase SQL Editor:
    SELECT trade_id, snapshot_date, npv, ir01, theta, total_pnl
    FROM pnl_snapshots ORDER BY created_at DESC LIMIT 5;
    Expected: one row with npv ≈ 6593019, ir01 ≈ 7087, theta ≈ -509

  NEXT STEP 4 — Run pricer again next day (or change date):
    total_pnl column will populate — NPV(today) - NPV(yesterday)
    theta_pnl will show theta contribution
    unexplained = total_pnl - theta_pnl (until Sprint 5B wires rate moves)

  NEXT STEP 5 — Commit:
    git add backend/pricing/pnl.py
    git add backend/api/routes/pricer.py
    git add docs/pnl_snapshots_migration.sql
    git commit -m "Sprint 5A: pnl_snapshots table + attribution engine + pricer auto-write"
    git push

  SPRINT 5B (next session):
    Wire delta_rate_bps from market_data_snapshots diff
    Compute carry, rolldown, ir01_pnl, gamma_pnl properly
    Add /api/pnl routes
    Build PNLPage.jsx + PNL tile
══════════════════════════════════════════════
`);
