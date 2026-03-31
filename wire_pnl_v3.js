// RIJEKA Sprint 5A: wire pnl snapshot - uses exact anchor from file dump
// node wire_pnl_v3.js

var fs   = require('fs');
var FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';

var content = fs.readFileSync(FILE, 'utf8');

if (content.includes('Sprint 5A: auto-write PNL snapshot')) {
  console.log('Already wired. Nothing to do.');
  process.exit(0);
}

// Exact anchor from dump: "curve_mode" key is just before "curve_pillars" in the return dict
// The return { comes before "curve_mode"
// We target the unique string that starts the return block
var OLD = '"curve_mode":        _curve_mode(request.curves),\n        "curve_pillars":';
var NEW_LINES = [
  '"curve_mode":        _curve_mode(request.curves),',
  '    }',
  '',
  '    # --- Sprint 5A: auto-write PNL snapshot ---',
  '    try:',
  '        _sd = str(val_date)',
  '        _write_pnl_snapshot(',
  '            db=db,',
  '            trade_id=str(trade.id),',
  '            snapshot_date=_sd,',
  '            npv=float(result.npv) if result.npv is not None else 0.0,',
  '            currency=trade.notional_ccy or "USD",',
  '            ir01=float(greeks.ir01) if greeks and greeks.ir01 is not None else 0.0,',
  '            ir01_disc=float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else 0.0,',
  '            theta=float(greeks.theta) if greeks and greeks.theta is not None else 0.0,',
  '            curve_inputs=[ci.dict() for ci in request.curves],',
  '            created_by=str(user.get("sub", "")),',
  '            valuation_date=_sd,',
  '        )',
  '    except Exception as _snap_err:',
  '        _pnl_logger.error("snapshot call failed: %s", str(_snap_err))',
  '',
  '    return {',
  '        "curve_mode":        _curve_mode(request.curves),',
  '        "curve_pillars":'
].join('\n');

// Try exact match first
if (content.includes(OLD)) {
  content = content.replace(OLD, NEW_LINES);
  fs.writeFileSync(FILE, content, 'utf8');
  console.log('Done. Snapshot call wired.');
} else {
  // Try with double spaces (from dump: "curve_pillars":  curve_pillar — two spaces)
  var OLD2 = '"curve_mode":        _curve_mode(request.curves),\n        "curve_pillars":  curve_pillars,';
  var NEW2_LINES = [
    '    # --- Sprint 5A: auto-write PNL snapshot ---',
    '    try:',
    '        _sd = str(val_date)',
    '        _write_pnl_snapshot(',
    '            db=db,',
    '            trade_id=str(trade.id),',
    '            snapshot_date=_sd,',
    '            npv=float(result.npv) if result.npv is not None else 0.0,',
    '            currency=trade.notional_ccy or "USD",',
    '            ir01=float(greeks.ir01) if greeks and greeks.ir01 is not None else 0.0,',
    '            ir01_disc=float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else 0.0,',
    '            theta=float(greeks.theta) if greeks and greeks.theta is not None else 0.0,',
    '            curve_inputs=[ci.dict() for ci in request.curves],',
    '            created_by=str(user.get("sub", "")),',
    '            valuation_date=_sd,',
    '        )',
    '    except Exception as _snap_err:',
    '        _pnl_logger.error("snapshot call failed: %s", str(_snap_err))',
    '    "curve_mode":        _curve_mode(request.curves),',
    '        "curve_pillars":  curve_pillars,'
  ].join('\n');

  // Simpler approach: find the return block by locating "curve_mode" line
  // and inserting snapshot call before the return { that precedes it
  var curveModeLine = '        "curve_mode":        _curve_mode(request.curves),';
  var idx = content.indexOf(curveModeLine);
  if (idx === -1) {
    curveModeLine = '        "curve_mode": _curve_mode(request.curves),';
    idx = content.indexOf(curveModeLine);
  }

  if (idx === -1) {
    console.log('ERROR: cannot find curve_mode line. Exact dump:');
    var cpIdx = content.indexOf('"curve_pillars"');
    console.log(JSON.stringify(content.slice(cpIdx - 100, cpIdx + 50)));
    process.exit(1);
  }

  // Walk back from idx to find 'return {'
  var before = content.slice(0, idx);
  var retIdx = before.lastIndexOf('    return {');
  if (retIdx === -1) {
    console.log('ERROR: cannot find return { before curve_mode');
    process.exit(1);
  }

  var SNAP_INSERT = [
    '    # --- Sprint 5A: auto-write PNL snapshot ---',
    '    try:',
    '        _sd = str(val_date)',
    '        _write_pnl_snapshot(',
    '            db=db,',
    '            trade_id=str(trade.id),',
    '            snapshot_date=_sd,',
    '            npv=float(result.npv) if result.npv is not None else 0.0,',
    '            currency=trade.notional_ccy or "USD",',
    '            ir01=float(greeks.ir01) if greeks and greeks.ir01 is not None else 0.0,',
    '            ir01_disc=float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else 0.0,',
    '            theta=float(greeks.theta) if greeks and greeks.theta is not None else 0.0,',
    '            curve_inputs=[ci.dict() for ci in request.curves],',
    '            created_by=str(user.get("sub", "")),',
    '            valuation_date=_sd,',
    '        )',
    '    except Exception as _snap_err:',
    '        _pnl_logger.error("snapshot call failed: %s", str(_snap_err))',
    '    return {'
  ].join('\n');

  content = content.slice(0, retIdx) + SNAP_INSERT + '\n' + content.slice(retIdx + '    return {'.length);
  fs.writeFileSync(FILE, content, 'utf8');
  console.log('Done. Snapshot call wired (fallback method).');
}

console.log('');
console.log('NEXT STEPS:');
console.log('  cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend');
console.log('  uvicorn main:app --reload');
console.log('');
console.log('  PRICER tile -> TRD-90992960 -> RUN PRICER');
console.log('');
console.log('  Verify in Supabase:');
console.log('  SELECT trade_id, snapshot_date, npv, ir01, theta, total_pnl');
console.log('  FROM pnl_snapshots ORDER BY created_at DESC LIMIT 5;');
console.log('  Expected: npv ~6593019  ir01 ~7087  theta ~-509  total_pnl = NULL');
