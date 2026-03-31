// Add print to pnl_snapshot except block to expose real error
// node debug_pnl_error.js

var fs   = require('fs');
var FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';
var content = fs.readFileSync(FILE, 'utf8');

var OLD = '        _pnl_logger.error("pnl_snapshot failed: %s %s", trade_id, str(_e))\n        try: db.rollback()\n        except: pass';
var NEW = '        print("PNL_SNAPSHOT_ERROR:", trade_id, type(_e).__name__, str(_e))\n        _pnl_logger.error("pnl_snapshot failed: %s %s", trade_id, str(_e))\n        try: db.rollback()\n        except: pass';

if (content.includes(OLD)) {
  content = content.replace(OLD, NEW);
  fs.writeFileSync(FILE, content, 'utf8');
  console.log('Added print to except block. uvicorn will auto-reload.');
  console.log('Run PRICER and look for PNL_SNAPSHOT_ERROR: in terminal.');
} else {
  console.log('Pattern not found. Dumping except block:');
  var idx = content.indexOf('pnl_logger.error');
  if (idx !== -1) console.log(JSON.stringify(content.slice(idx - 20, idx + 150)));
}
