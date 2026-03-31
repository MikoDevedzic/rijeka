// RIJEKA Sprint 5A: wire _write_pnl_snapshot into price route
// Targets the exact return anchor: "curve_pillars": curve_pillars,
// node wire_pnl_snapshot.js

var fs   = require('fs');
var path = require('path');
var ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
var FILE = path.join(ROOT, 'backend', 'api', 'routes', 'pricer.py');

if (!fs.existsSync(FILE)) {
  console.log('ERROR: pricer.py not found');
  process.exit(1);
}

// Read with encoding detection
var buf = fs.readFileSync(FILE);
var content;

// Detect UTF-16 BOM
if (buf[0] === 0xff && buf[1] === 0xfe) {
  content = buf.toString('utf16le');
  console.log('Detected UTF-16LE encoding');
} else if (buf[0] === 0xfe && buf[1] === 0xff) {
  content = buf.toString('utf16be');
  console.log('Detected UTF-16BE encoding');
} else {
  content = buf.toString('utf8');
  console.log('Detected UTF-8 encoding');
}

// Check if already wired
if (content.includes('Sprint 5A: auto-write PNL snapshot')) {
  console.log('Snapshot call already wired. Nothing to do.');
  process.exit(0);
}

// The return dict in the price route starts with "curve_pillars"
// We insert the snapshot call just before that return statement
// The pattern is:     return {\n...    "curve_pillars":
// Find the last occurrence of 'return {' before '"curve_pillars"'

var anchor = '"curve_pillars":     curve_pillars,';
var anchor2 = '"curve_pillars": curve_pillars,';

var useAnchor = content.includes(anchor) ? anchor : anchor2;

if (!content.includes(useAnchor)) {
  // Try a more flexible search
  var idx = content.indexOf('"curve_pillars"');
  if (idx === -1) {
    console.log('ERROR: could not find curve_pillars anchor in pricer.py');
    console.log('');
    console.log('MANUAL STEP: In backend/api/routes/pricer.py,');
    console.log('find the return statement of the price route and add before it:');
    console.log('');
    console.log('    _sd = str(val_date)');
    console.log('    _write_pnl_snapshot(');
    console.log('        db=db,');
    console.log('        trade_id=str(trade.id),');
    console.log('        snapshot_date=_sd,');
    console.log('        npv=float(result.npv) if result.npv is not None else 0.0,');
    console.log('        currency=trade.notional_ccy or "USD",');
    console.log('        ir01=float(greeks.ir01) if greeks and greeks.ir01 is not None else 0.0,');
    console.log('        ir01_disc=float(greeks.ir01_disc) if greeks and greeks.ir01_disc is not None else 0.0,');
    console.log('        theta=float(greeks.theta) if greeks and greeks.theta is not None else 0.0,');
    console.log('        curve_inputs=[ci.dict() for ci in request.curves],');
    console.log('        created_by=str(user.get("sub", "")),');
    console.log('        valuation_date=_sd,');
    console.log('    )');
    process.exit(1);
  }
  // Walk back from curve_pillars idx to find 'return {'
  var segment = content.slice(0, idx);
  var retIdx = segment.lastIndexOf('return {');
  useAnchor = content.slice(retIdx, idx + 20).split('\n')[0];
  console.log('Using flexible anchor: ' + useAnchor.trim());
}

var SNAP_CALL = [
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

// Find return { just before curve_pillars
var cpIdx = content.indexOf(useAnchor);
var beforeCp = content.slice(0, cpIdx);
var returnIdx = beforeCp.lastIndexOf('return {');

if (returnIdx === -1) {
  console.log('ERROR: could not find return { before curve_pillars');
  process.exit(1);
}

// Replace that specific 'return {' with snapshot call + return {
content = content.slice(0, returnIdx) + SNAP_CALL + '\n' + content.slice(returnIdx + 'return {'.length);

// Write back with same encoding
var encoding = (buf[0] === 0xff && buf[1] === 0xfe) ? 'utf16le' :
               (buf[0] === 0xfe && buf[1] === 0xff) ? 'utf16be' : 'utf8';

if (encoding === 'utf8') {
  fs.writeFileSync(FILE, content, 'utf8');
} else {
  fs.writeFileSync(FILE, Buffer.from(content, encoding));
}

console.log('');
console.log('Wired _write_pnl_snapshot before price route return');
console.log('Written: backend/api/routes/pricer.py');
console.log('');
console.log('NEXT STEPS:');
console.log('  1. cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend');
console.log('     uvicorn main:app --reload');
console.log('');
console.log('  2. PRICER tile -> TRD-90992960 -> RUN PRICER');
console.log('');
console.log('  3. Verify in Supabase SQL Editor:');
console.log('     SELECT trade_id, snapshot_date, npv, ir01, theta, total_pnl');
console.log('     FROM pnl_snapshots ORDER BY created_at DESC LIMIT 5;');
console.log('     Expected: npv ~6593019, ir01 ~7087, theta ~-509, total_pnl = NULL (first run)');
console.log('');
console.log('  4. git add backend/pricing/pnl.py backend/api/routes/pricer.py');
console.log('     git commit -m "Sprint 5A: pnl attribution engine + pricer auto-write"');
console.log('     git push');
