// SPRINT_4G_2_pricer_transparency.js
// Patches backend/api/routes/pricer.py:
//   - Adds df, zero_rate to cashflow serialization in _lr()
//   - Adds curve_pillars to /price response (pillar dates + zero rates + DFs)
// Run from Rijeka root: node SPRINT_4G_2_pricer_transparency.js

const fs = require('fs');
const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';
let src = fs.readFileSync(FILE, 'utf8');
const orig = src;

// 1. Add df and zero_rate to cashflow serialization in _lr()
src = src.replace(
  `                    "rate":          float(cf.rate)   if cf.rate   is not None else None,
                    "dcf":           float(cf.dcf)    if cf.dcf    is not None else None,
                    "amount":        float(cf.amount) if cf.amount is not None else None,`,
  `                    "rate":          float(cf.rate)      if cf.rate      is not None else None,
                    "dcf":           float(cf.dcf)       if cf.dcf       is not None else None,
                    "amount":        float(cf.amount)    if cf.amount    is not None else None,
                    "df":            float(cf.df)        if hasattr(cf, 'df')        and cf.df        is not None else None,
                    "zero_rate":     float(cf.zero_rate) if hasattr(cf, 'zero_rate') and cf.zero_rate is not None else None,`
);

// 2. Add curve_pillars to the /price response
// After building curves{}, extract pillar info to return to client
// Inject after the curves dict is built, before pricing

src = src.replace(
  `    if not curves:
        raise HTTPException(status_code=422, detail="At least one curve required")

    # Price`,
  `    if not curves:
        raise HTTPException(status_code=422, detail="At least one curve required")

    # Serialize curve pillars for transparency panel
    curve_pillars = {}
    for cid, curve in curves.items():
        pils = []
        for d, r in curve._pillars:
            t = (d - val_date).days / 365.25
            if t <= 0:
                continue
            import math as _math
            df_val = _math.exp(-r * t)
            pils.append({
                "date":      d.isoformat(),
                "zero_rate": round(r * 100, 4),      # as %
                "df":        round(df_val, 6),
                "t":         round(t, 4),
            })
        curve_pillars[cid] = pils

    # Price`
);

// 3. Add curve_pillars to the return dict
src = src.replace(
  `    return {
        "trade_id":       str(trade.id),
        "valuation_date": val_date.isoformat(),
        "curve_mode":     _curve_mode(request.curves),
        "npv":   float(result.npv)   if result.npv   is not None else None,`,
  `    return {
        "trade_id":       str(trade.id),
        "valuation_date": val_date.isoformat(),
        "curve_mode":     _curve_mode(request.curves),
        "curve_pillars":  curve_pillars,
        "npv":   float(result.npv)   if result.npv   is not None else None,`
);

if (src === orig) {
  console.log('No changes — check anchors');
  process.exit(1);
}
fs.writeFileSync(FILE, src, 'utf8');
console.log('Done. pricer.py patched — df/zero_rate/curve_pillars in response');
