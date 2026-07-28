#!/usr/bin/env bash
# Stitches record.js's raw screen-capture (video/*.webm) together with the
# title/outro cards from make-cards.sh into one polished, shareable mp4.
#
# Usage: ./assemble.sh [output.mp4]
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$DIR/demo.mp4}"

WEBM=$(ls "$DIR"/video/*.webm 2>/dev/null | head -n1 || true)
if [ -z "$WEBM" ]; then
  echo "No recording found in $DIR/video — run 'node record.js' first." >&2
  exit 1
fi
if [ ! -f "$DIR/cards/title.mp4" ] || [ ! -f "$DIR/cards/outro.mp4" ]; then
  echo "Missing title/outro cards — run ./make-cards.sh first." >&2
  exit 1
fi

DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WEBM")
FADE_OUT_START=$(python3 -c "print(max(0, $DURATION - 0.4))")

MAIN="$DIR/.main.mp4"
ffmpeg -y -i "$WEBM" \
  -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=$FADE_OUT_START:d=0.4" \
  -pix_fmt yuv420p -c:v libx264 -crf 18 -r 25 "$MAIN"

LIST="$DIR/.concat_list.txt"
printf "file '%s'\nfile '%s'\nfile '%s'\n" \
  "$DIR/cards/title.mp4" "$MAIN" "$DIR/cards/outro.mp4" > "$LIST"

ffmpeg -y -f concat -safe 0 -i "$LIST" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p -r 25 -movflags +faststart "$OUT"

rm -f "$MAIN" "$LIST"
echo "Wrote $OUT"
