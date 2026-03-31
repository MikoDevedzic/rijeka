// RIJEKA Sprint 5A: complete rewrite of _write_pnl_snapshot
// Replaces entire helper function with correct SQLAlchemy 2.x + psycopg2 syntax
// node rewrite_pnl_helper.js

var fs   = require('fs');
var FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';
var content = fs.readFileSync(FILE, 'utf8');

// Find the entire _write_pnl_snapshot function and replace it completely
var START_MARKER = 'def _write_pnl_snapshot(';
var END_MARKER   = '\n@router.post("/price")';

var startIdx = content.indexOf(START_MARKER);
var endIdx   = content.indexOf(END_MARKER);

if (startIdx === -1 || endIdx === -1) {
  console.log('ERROR: could not find function boundaries');
  console.log('startIdx=' + startIdx + ' endIdx=' + endIdx);
  process.exit(1);
}

var NEW_HELPER = [
'def _write_pnl_snapshot(db, trade_id, snapshot_date, npv, currency,',
'                         ir01, ir01_disc, theta, curve_inputs, created_by, valuation_date):',
'    """',
'    Upsert pnl_snapshot after every pricer run.',
'    Non-fatal -- pricer result returned even if this fails.',
'    Idempotent -- UPSERT on (trade_id, snapshot_date).',
'    Uses text() with named params compatible with psycopg2.',
'    """',
'    import json as _json2',
'    try:',
'        # Fetch previous snapshot to compute total_pnl',
'        prev = db.execute(',
'            text(',
'                "SELECT npv, theta FROM pnl_snapshots"',
'                " WHERE trade_id = :tid AND snapshot_date < :today"',
'                " ORDER BY snapshot_date DESC LIMIT 1"',
'            ),',
'            {"tid": trade_id, "today": snapshot_date}',
'        ).fetchone()',
'',
'        total_pnl   = None',
'        theta_pnl   = 0.0',
'        unexplained = 0.0',
'',
'        if prev:',
'            total_pnl   = npv - float(prev.npv or 0)',
'            theta_pnl   = float(prev.theta or 0)',
'            unexplained = total_pnl - theta_pnl',
'',
'        # Serialize curve_inputs to JSON string -- cast to jsonb in SQL',
'        ci_json = _json2.dumps(curve_inputs) if curve_inputs else "[]"',
'',
'        db.execute(',
'            text(',
'                "INSERT INTO pnl_snapshots"',
'                " (trade_id, snapshot_date, npv, currency,"',
'                "  ir01, ir01_disc, theta,"',
'                "  total_pnl, theta_pnl, unexplained,"',
'                "  source, curve_inputs, valuation_date, created_by)"',
'                " VALUES"',
'                " (:tid, :sd, :npv, :cur,"',
'                "  :ir01, :ir01d, :theta,"',
'                "  :tp, :tpnl, :unex,"',
'                "  \'PRICER\', cast(:ci as jsonb), :vd, :cb)"',
'                " ON CONFLICT (trade_id, snapshot_date) DO UPDATE SET"',
'                "  npv            = EXCLUDED.npv,"',
'                "  ir01           = EXCLUDED.ir01,"',
'                "  ir01_disc      = EXCLUDED.ir01_disc,"',
'                "  theta          = EXCLUDED.theta,"',
'                "  total_pnl      = EXCLUDED.total_pnl,"',
'                "  theta_pnl      = EXCLUDED.theta_pnl,"',
'                "  unexplained    = EXCLUDED.unexplained,"',
'                "  curve_inputs   = EXCLUDED.curve_inputs,"',
'                "  valuation_date = EXCLUDED.valuation_date"',
'            ),',
'            {',
'                "tid":   trade_id,',
'                "sd":    snapshot_date,',
'                "npv":   npv,',
'                "cur":   currency,',
'                "ir01":  ir01,',
'                "ir01d": ir01_disc,',
'                "theta": theta,',
'                "tp":    total_pnl,',
'                "tpnl":  theta_pnl,',
'                "unex":  unexplained,',
'                "ci":    ci_json,',
'                "vd":    valuation_date,',
'                "cb":    created_by,',
'            }',
'        )',
'        db.commit()',
'        _pnl_logger.info(',
'            "pnl_snapshot: %s %s npv=%.2f total_pnl=%s",',
'            trade_id, snapshot_date, npv,',
'            "%.2f" % total_pnl if total_pnl is not None else "NULL"',
'        )',
'',
'    except Exception as _e:',
'        _pnl_logger.error("pnl_snapshot failed: %s %s", trade_id, str(_e))',
'        try: db.rollback()',
'        except: pass',
''
].join('\n');

var before = content.slice(0, startIdx);
var after  = content.slice(endIdx);  // keeps \n@router.post("/price") onwards

content = before + NEW_HELPER + after;

fs.writeFileSync(FILE, content, 'utf8');

console.log('Rewrote _write_pnl_snapshot cleanly');
console.log('Written: backend/api/routes/pricer.py');
console.log('');
console.log('uvicorn will auto-reload. Then:');
console.log('  1. PRICER -> set date 2026-03-27 -> RUN PRICER');
console.log('     Watch terminal: pnl_snapshot: <uuid> 2026-03-27 npv=... total_pnl=NULL');
console.log('');
console.log('  2. Change date to 2026-03-28 -> RUN PRICER');
console.log('     Watch terminal: pnl_snapshot: <uuid> 2026-03-28 npv=... total_pnl=0.00');
console.log('     (total_pnl=0 because same curves, NPV identical)');
console.log('');
console.log('  3. Supabase:');
console.log('     SELECT trade_id, snapshot_date, npv, ir01, theta, total_pnl');
console.log('     FROM pnl_snapshots ORDER BY snapshot_date;');
