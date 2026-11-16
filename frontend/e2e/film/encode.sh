#!/usr/bin/env bash
# e2e/film/encode.sh — the frames the film wrote (e2e/.out/film/frames, 30 a second) as one WebM, VP9, at a quality that
# keeps type sharp. Uses the encoder Playwright ships (it has no H.264: an .mp4 needs a full ffmpeg).
#   bash e2e/film/encode.sh [out.webm]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT_DIR="$HERE/../.out/film"; OUT="${1:-$OUT_DIR/rijeka-walkthrough.webm}"
FF="$( (ls -d "$HOME"/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac "$HOME"/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux 2>/dev/null || true) | tail -1)"      # one of the two places exists, not both
[ -x "$FF" ] || { echo "Playwright's ffmpeg was not found" >&2; exit 1; }
n=$(ls "$OUT_DIR/frames" | wc -l | tr -d ' ')
echo "$n frames, $((n / 30)) seconds"
find "$OUT_DIR/frames" -name 'f-*.jpg' | sort | xargs cat | "$FF" -hide_banner -loglevel error -y -f image2pipe -c:v mjpeg -framerate 30 -i pipe:0 \
  -c:v libvpx-vp9 -crf 18 -b:v 0 -pix_fmt yuv420p -row-mt 1 -deadline good -cpu-used 2 -g 60 "$OUT"
ls -lh "$OUT" | awk '{print $5, $9}'
