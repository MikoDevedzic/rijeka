#!/usr/bin/env bash
# Compile docs/methodology/rijeka_methodology.tex (tectonic: brew install tectonic)
# and place the PDF where the app and the landing site serve it.
set -euo pipefail
cd "$(dirname "$0")/../../docs/methodology"
tectonic -X compile rijeka_methodology.tex > build.log 2>&1 || { grep -n "^!" -A2 build.log; exit 1; }
cp rijeka_methodology.pdf ../../frontend/public/methodology/rijeka_methodology.pdf
[ -d ../../netlify_drop ] && mkdir -p ../../netlify_drop/methodology && cp rijeka_methodology.pdf ../../netlify_drop/methodology/
echo "built $(ls -l rijeka_methodology.pdf | awk '{print $5}') bytes → frontend/public/methodology/ (and netlify_drop/methodology/ if present)"
