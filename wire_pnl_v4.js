// RIJEKA Sprint 5A: fix snapshot call location
// Removes it from cashflows/generate route, adds it to price route
// node wire_pnl_v4.js

var fs   = require('fs');
var FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';

var content = fs.readFileSync(FILE, 'utf8');

// ── Step 1: Remove the misplaced snapshot call from cashflows route ──────────

var WRONG_BLOCK = [
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

if (!content.includes(WRONG_BLOCK)) {
  console.log('ERROR: cannot find misplaced block. Dumping Sprint 5A context:');
  var idx = content.indexOf('Sprint 5A');
  if (idx !== -1) console.log(JSON.stringify(content.slice(idx - 50, idx + 400)));
  process.exit(1);
}

// Remove the wrong block, restore plain 'return {'
content = content.replace(WRONG_BLOCK, '    return {');
console.log('Removed snapshot call from cashflows/generate route');

// ── Step 2: Insert in the correct place — price route ────────────────────────
// The price route return dict contains "curve_pillars" and "ir01" and "npv"
// Unique anchor: the greeks return lines only exist in the price route
// Use "ir01_disc" key in the return dict as the anchor — unique to price route

var PRICE_RETURN_ANCHOR = '        "ir01_disc":  float(greeks.ir01_disc)';

if (!content.includes(PRICE_RETURN_ANCHOR)) {
  console.log('ERROR: cannot find price route return anchor "ir01_disc"');
  process.exit(1);
}

// Find the 'return {' that precedes this anchor
var anchorIdx = content.indexOf(PRICE_RETURN_ANCHOR);
var beforeAnchor = content.slice(0, anchorIdx);
var retIdx = beforeAnchor.lastIndexOf('    return {');

if (retIdx === -1) {
  console.log('ERROR: cannot find return { before price route anchor');
  process.exit(1);
}

var SNAP_CALL = [
'    # --- Sprint 5A: auto-write PNL snapshot (price route only) ---',
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

content = (
  content.slice(0, retIdx) +
  SNAP_CALL +
  '\n' +
  content.slice(retIdx + '    return {'.length)
);

console.log('Wired snapshot call into price route');

// ── Step 3: Fix SQLAlchemy text() wrapper in _write_pnl_snapshot ─────────────
// Raw string SQL needs text() in SQLAlchemy 2.x
// The SELECT in _write_pnl_snapshot uses plain string — wrap with text()

var OLD_SELECT = [
'        prev = db.execute(',
'            "SELECT npv, theta FROM pnl_snapshots"',
'            " WHERE trade_id = :tid AND snapshot_date < :today"',
'            " ORDER BY snapshot_date DESC LIMIT 1",',
'            {"tid": trade_id, "today": snapshot_date}',
'        ).fetchone()'
].join('\n');

var NEW_SELECT = [
'        from sqlalchemy import text as _text',
'        prev = db.execute(',
'            _text(',
'                "SELECT npv, theta FROM pnl_snapshots"',
'                " WHERE trade_id = :tid AND snapshot_date < :today"',
'                " ORDER BY snapshot_date DESC LIMIT 1"',
'            ),',
'            {"tid": trade_id, "today": snapshot_date}',
'        ).fetchone()'
].join('\n');

var OLD_INSERT = [
'        db.execute(',
'            "INSERT INTO pnl_snapshots"',
'            " (trade_id, snapshot_date, npv, currency,"'
].join('\n');

var NEW_INSERT = [
'        db.execute(',
'            _text(',
'                "INSERT INTO pnl_snapshots"',
'                " (trade_id, snapshot_date, npv, currency,"'
].join('\n');

// Find the closing paren of the INSERT execute call and add closing paren for _text()
// The INSERT params end with the dict closing brace
// Pattern: '        )\n        db.commit()'
var INSERT_CLOSE = '        )\n        db.commit()';
var INSERT_CLOSE_NEW = '        ))\n        db.commit()';

if (content.includes(OLD_SELECT)) {
  content = content.replace(OLD_SELECT, NEW_SELECT);
  console.log('Fixed SELECT with text() wrapper');
} else {
  console.log('SELECT already has text() or pattern changed -- skipping');
}

if (content.includes(OLD_INSERT)) {
  content = content.replace(OLD_INSERT, NEW_INSERT);
  // Also close the _text() paren
  if (content.includes(INSERT_CLOSE)) {
    content = content.replace(INSERT_CLOSE, INSERT_CLOSE_NEW);
    console.log('Fixed INSERT with text() wrapper');
  }
} else {
  console.log('INSERT already has text() or pattern changed -- skipping');
}

fs.writeFileSync(FILE, content, 'utf8');

console.log('');
console.log('Written: backend/api/routes/pricer.py');
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
