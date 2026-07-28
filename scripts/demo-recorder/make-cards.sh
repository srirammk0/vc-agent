#!/usr/bin/env bash
# Renders the title/outro cards used by assemble.sh, matching the dashboard's
# own palette (src/app/globals.css: --page-bg, --heading, --label, --accent).
#
# Usage: FONT_DIR=/path/to/inter-fonts ./make-cards.sh
set -euo pipefail

OUT_DIR="$(dirname "$0")/cards"
mkdir -p "$OUT_DIR"

# Needs Inter-Bold.ttf, Inter-SemiBold.ttf, Inter-Regular.ttf (or point
# FONT_DIR at any font family with those three weights).
FONT_DIR="${FONT_DIR:-/usr/share/fonts/truetype/inter}"
BOLD="$FONT_DIR/Inter-Bold.ttf"
SEMI="$FONT_DIR/Inter-SemiBold.ttf"
REG="$FONT_DIR/Inter-Regular.ttf"

for f in "$BOLD" "$SEMI" "$REG"; do
  if [ ! -f "$f" ]; then
    echo "Missing font: $f (set FONT_DIR to a directory with Inter-{Bold,SemiBold,Regular}.ttf)" >&2
    exit 1
  fi
done

ffmpeg -y -f lavfi -i "color=c=0xF9F9EF:s=1440x900:d=3.2:r=25" -vf "
drawtext=fontfile=$SEMI:text='PRODUCT DEMO':fontcolor=0x007AFF:fontsize=20:x=(w-text_w)/2:y=h/2-140,
drawtext=fontfile=$BOLD:text='VC Research Agent':fontcolor=0x061F00:fontsize=56:x=(w-text_w)/2:y=h/2-95,
drawtext=fontfile=$REG:text='An autonomous AI scout for pre-seed and seed startups':fontcolor=0x6B6760:fontsize=22:x=(w-text_w)/2:y=h/2-10,
drawtext=fontfile=$REG:text='Dashboard shown with illustrative sample data':fontcolor=0x9A968D:fontsize=16:x=(w-text_w)/2:y=h/2+35,
fade=t=in:st=0:d=0.5,fade=t=out:st=2.6:d=0.6
" -pix_fmt yuv420p -c:v libx264 -crf 18 "$OUT_DIR/title.mp4"

ffmpeg -y -f lavfi -i "color=c=0xF9F9EF:s=1440x900:d=3.2:r=25" -vf "
drawtext=fontfile=$BOLD:text='Dealflow, on autopilot':fontcolor=0x061F00:fontsize=48:x=(w-text_w)/2:y=h/2-80,
drawtext=fontfile=$REG:text='Pydantic AI  x  Trigger.dev  x  Supabase  x  Next.js':fontcolor=0x6B6760:fontsize=22:x=(w-text_w)/2:y=h/2-8,
drawtext=fontfile=$REG:text='Exa and Linkup research  -  Supermemory thesis and preferences':fontcolor=0x9A968D:fontsize=17:x=(w-text_w)/2:y=h/2+30,
fade=t=in:st=0:d=0.5,fade=t=out:st=2.6:d=0.6
" -pix_fmt yuv420p -c:v libx264 -crf 18 "$OUT_DIR/outro.mp4"

echo "Wrote $OUT_DIR/title.mp4 and $OUT_DIR/outro.mp4"
