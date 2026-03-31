// RIJEKA: Remove _write_pnl_snapshot from pricer route
// PNL snapshots belong in PNL module, not pricer
// node remove_pnl_from_pricer.js

var fs   = require('fs');
var FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';
var content = fs.readFileSync(FILE, 'utf8');

// Remove the snapshot call block from the price route
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

if (content.includes(SNAP_CALL)) {
  content = content.replace(SNAP_CALL, '    return {');
  console.log('Removed snapshot call from price route');
} else {
  // Try finding and removing any Sprint 5A block
  var idx = content.indexOf('# --- Sprint 5A: auto-write PNL snapshot');
  if (idx !== -1) {
    var returnIdx = content.indexOf('    return {', idx);
    if (returnIdx !== -1) {
      content = content.slice(0, idx) + content.slice(returnIdx);
      console.log('Removed Sprint 5A block (fallback method)');
    }
  } else {
    console.log('Snapshot call not found - may already be removed');
  }
}

// Also remove the _write_pnl_snapshot helper function and pnl imports
// Keep pnl.py and the table - just decouple from pricer route
// Remove imports
content = content.replace('from pricing.pnl import PNLAttribution, compute_attribution\n', '');
content = content.replace('from datetime import date as _date_today\n', '');
content = content.replace('import logging as _logging\n', '');
content = content.replace('_pnl_logger = _logging.getLogger(__name__)\n', '');

// Remove the entire _write_pnl_snapshot function
var FN_START = 'def _write_pnl_snapshot(';
var FN_END   = '\n@router.post("/price")';
var fnStart  = content.indexOf(FN_START);
var fnEnd    = content.indexOf(FN_END);
if (fnStart !== -1 && fnEnd !== -1) {
  content = content.slice(0, fnStart) + content.slice(fnEnd + 1);
  console.log('Removed _write_pnl_snapshot helper function');
}

// Remove debug print if present
content = content.replace('        print("PNL_SNAPSHOT_ERROR:", trade_id, type(_e).__name__, str(_e))\n', '');

fs.writeFileSync(FILE, content, 'utf8');
console.log('Done. pricer.py is clean.');
console.log('PNL snapshot writes will live in the PNL module.');
