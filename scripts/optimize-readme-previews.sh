#!/usr/bin/env bash
set -euo pipefail

# Run from any directory. Source GIFs and videos are never overwritten.
preview_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
command -v ffmpeg >/dev/null || { printf 'ffmpeg is required.\n' >&2; exit 1; }
mkdir -p "$preview_root/assets/readme/previews"

for demo in light-theme-demo dark-theme-demo style-2a-demo style-2b-demo style-3-demo style-3-community-fire style-4-cozy-station style-4-cozy-cafe; do
  ffmpeg -hide_banner -loglevel error -y \
    -i "$preview_root/assets/readme/$demo.gif" \
    -filter_complex '[0:v]fps=8,scale=400:225:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle' \
    -loop 0 "$preview_root/assets/readme/previews/$demo.gif"
done

# Use short, lightweight excerpts for the new video sources.
for demo in style-5-japan style-5-egypt; do
  ffmpeg -hide_banner -loglevel error -y \
    -i "$preview_root/assets/readme/$demo.mp4" -t 10 \
    -filter_complex '[0:v]fps=6,scale=400:225:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle' \
    -loop 0 "$preview_root/assets/readme/previews/$demo.gif"
done

ffmpeg -hide_banner -loglevel error -y \
  -i "$preview_root/assets/readme/style-5-japan.mp4" -t 10 \
  -filter_complex '[0:v]fps=6,scale=640:360:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle' \
  -loop 0 "$preview_root/assets/readme/previews/style-5-japan-hero.gif"

printf 'Built lightweight README previews; original media unchanged.\n'
