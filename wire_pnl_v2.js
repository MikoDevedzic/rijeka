// RIJEKA Sprint 5A: wire pnl snapshot into pricer.py
// Simple direct string replacement on unique multiline anchor
// node wire_pnl_v2.js

var fs   = require('fs');
var path = require('path');
var FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';

var content = fs.readFileSync(FILE, 'utf8');

if (content.includes('Sprint 5A: auto-write PNL snapshot')) {
  console.log('Already wired. Nothing to do.');
  process.exit(0);
}

// Exact anchor — the return dict of the price route starts with "curve_pillars"
// This string is unique in the file
var OLD = '    return {\n        "curve_pillars":';
var NEW = [
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
  '    return {',
  '        "curve_pillars":'
].join('\n');

if (!content.includes(OLD)) {
  // Try Windows line endings
  OLD = '    return {\r\n        "curve_pillars":';
  NEW = NEW.split('\n').join('\r\n');
}

if (!content.includes(OLD)) {
  console.log('ERROR: anchor not found. Dumping first 50 chars around curve_pillars:');
  var idx = content.indexOf('"curve_pillars"');
  if (idx > 20) console.log(JSON.stringify(content.slice(idx - 30, idx + 30)));
  console.log('');
  console.log('MANUAL STEP: open backend/api/routes/pricer.py');
  console.log('Find:   return {');
  console.log('        "curve_pillars": curve_pillars,');
  console.log('Add BEFORE that return block:');
  console.log('    _sd = str(val_date)');
  console.log('    _write_pnl_snapshot(db=db, trade_id=str(trade.id), snapshot_date=_sd,');
  console.log('        npv=float(result.npv) if result.npv is not None else 0.0,');
  console.log('        currency=trade.notional_ccy or "USD",');
  console.log('        ir01=float(greeks.ir01) if greeks and greeks.ir01 is not None else 0.0,');
  console.log('        ir01_disc=float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else 0.0,');
  console.log('        theta=float(greeks.theta) if greeks and greeks.theta is not None else 0.0,');
  console.log('        curve_inputs=[ci.dict() for ci in request.curves],');
  console.log('        created_by=str(user.get("sub","")), valuation_date=_sd)');
  process.exit(1);
}

content = content.replace(OLD, NEW);
fs.writeFileSync(FILE, content, 'utf8');

console.log('Done. Snapshot call wired into price route.');
console.log('');
console.log('NEXT STEPS:');
console.log('  cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend');
console.log('  uvicorn main:app --reload');
console.log('');
console.log('  Then: PRICER tile -> TRD-90992960 -> RUN PRICER');
console.log('  Then check Supabase:');
console.log('  SELECT trade_id, snapshot_date, npv, ir01, theta, total_pnl');
console.log('  FROM pnl_snapshots ORDER BY created_at DESC LIMIT 5;');
