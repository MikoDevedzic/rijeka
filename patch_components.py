import sys

# ── 1. OISDetail.jsx — fix 2 hardcoded #344e62 in sparkline SVG ──────────────
ois_path = r"C:\Users\mikod\OneDrive\Desktop\Rijeka\frontend\src\components\market-data\OISDetail.jsx"

with open(ois_path, 'r', encoding='utf-8') as f:
    ois = f.read()

OLD1 = 'fill="#344e62" fontSize="7" fontFamily="monospace">{rmax.toFixed(2)}%</text>'
NEW1 = 'fill="#526878" fontSize="7" fontFamily="monospace">{rmax.toFixed(2)}%</text>'

OLD2 = 'fill="#344e62" fontSize="7" fontFamily="monospace">{rmin.toFixed(2)}%</text>'
NEW2 = 'fill="#526878" fontSize="7" fontFamily="monospace">{rmin.toFixed(2)}%</text>'

if OLD1 not in ois:
    print("WARNING: OISDetail rmax fill not found — may already be patched")
else:
    ois = ois.replace(OLD1, NEW1, 1)
    print("OK: OISDetail.jsx rmax fill patched")

if OLD2 not in ois:
    print("WARNING: OISDetail rmin fill not found — may already be patched")
else:
    ois = ois.replace(OLD2, NEW2, 1)
    print("OK: OISDetail.jsx rmin fill patched")

with open(ois_path, 'w', encoding='utf-8') as f:
    f.write(ois)

# ── 2. useMarketDataStore.js — default typeFilter to 'OIS' ───────────────────
store_path = r"C:\Users\mikod\OneDrive\Desktop\Rijeka\frontend\src\store\useMarketDataStore.js"

with open(store_path, 'r', encoding='utf-8') as f:
    store = f.read()

OLD_FILTER = "  typeFilter: 'all',"
NEW_FILTER = "  typeFilter: 'OIS',"

if OLD_FILTER not in store:
    print("ERROR: typeFilter default not found in store — check manually")
    sys.exit(1)

store = store.replace(OLD_FILTER, NEW_FILTER, 1)

with open(store_path, 'w', encoding='utf-8') as f:
    f.write(store)

print("OK: useMarketDataStore.js typeFilter default set to 'OIS'")
print("\nAll 3 patches applied. Run: npm run dev to verify.")
