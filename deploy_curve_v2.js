// deploy_curve_v2.js
// Deploys curve_v2.py and updates bootstrap.py to pass DFs directly.
// Run: node C:\Users\mikod\OneDrive\Desktop\Rijeka\deploy_curve_v2.js

const fs = require('fs');
const { execSync } = require('child_process');

const CURVE_SRC = 'C:\\Users\\mikod\\Downloads\\curve_v2.py';
const CURVE_DST = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\pricing\\curve.py';
const CURVE_BAK = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\pricing\\curve_v1_backup.py';
const BOOT_PATH = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\pricing\\bootstrap.py';

// 1. Backup existing curve.py
fs.copyFileSync(CURVE_DST, CURVE_BAK);
console.log('Backed up curve.py -> curve_v1_backup.py');

// 2. Deploy curve_v2.py
fs.copyFileSync(CURVE_SRC, CURVE_DST);
console.log('Deployed curve_v2.py -> curve.py');

// 3. Update bootstrap.py: pass df_pillars directly instead of converting to zero rates
let boot = fs.readFileSync(BOOT_PATH, 'utf8');

// Find and replace the final conversion block
const py = `
import re

PATH = r'${BOOT_PATH.replace(/\\/g, '\\\\')}'

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the zero-rate conversion block and replace with direct DF pass
# The block converts DFs to zero rates then builds Curve with zero rates
# We replace it with direct DF pillar pass

old_block = '''    # -- Convert to cc zero rates for Curve constructor --'''

# Find the zero_pillars block
import re
# Match from "sorted_pil = _sorted_dedup" near the end of bootstrap_curve
# to "return Curve(...)"
pattern = r'(    # .* Convert to cc zero rates.*?\\n.*?sorted_pil = _sorted_dedup\\(df_pillars\\)\\n    zero_pillars = \\[\\]\\n    for d, df in sorted_pil:.*?return Curve\\(valuation_date=valuation_date, pillars=zero_pillars\\))'
match = re.search(pattern, content, re.DOTALL)

if match:
    old_text = match.group(0)
    new_text = """    # Pass DFs directly to Curve — no ln/exp round-trip precision loss.
    # Curve._interp_df uses same calendar-day log-linear interpolation as
    # bootstrap._interp_df, ensuring NPV = $0 at par rate.
    sorted_pil = _sorted_dedup(df_pillars)
    return Curve(valuation_date=valuation_date, df_pillars=sorted_pil)"""
    content = content.replace(old_text, new_text)
    print('Replaced zero_pillars block with direct DF pass')
else:
    # Try simpler search
    old_simple = '''    # \\u2500\\u2500 Convert to cc zero rates for Curve constructor'''
    idx = content.find('zero_pillars = []')
    if idx > -1:
        # Find start (sorted_pil line before zero_pillars)
        start = content.rfind('sorted_pil = _sorted_dedup(df_pillars)', 0, idx)
        # Find end (return Curve line)
        end_idx = content.find('return Curve(valuation_date=valuation_date', idx)
        end_idx = content.find('\\n', end_idx) + 1
        old_block = content[start:end_idx]
        new_block = """    sorted_pil = _sorted_dedup(df_pillars)
    return Curve(valuation_date=valuation_date, df_pillars=sorted_pil)
"""
        content = content[:start] + new_block + content[end_idx:]
        print(f'Replaced block at positions {start}-{end_idx}')
    else:
        print('ERROR: could not find zero_pillars block')
        exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print('bootstrap.py updated to pass DFs directly to Curve.')
`;

fs.writeFileSync('_deploy.py', py);
try {
  console.log(execSync('python _deploy.py', {encoding:'utf8'}));
} catch(e) {
  try { console.log(execSync('python3 _deploy.py', {encoding:'utf8'})); }
  catch(e2) { console.error('Python error:', e2.stderr || e2.message); }
}
try { fs.unlinkSync('_deploy.py'); } catch(e) {}

console.log('\nDone. Now restart backend:');
console.log('taskkill /f /im python3.13.exe');
console.log('cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend && python -m uvicorn main:app --reload --port 8000');
console.log('\nTo revert: copy curve_v1_backup.py -> curve.py');
