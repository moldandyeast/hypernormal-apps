#!/bin/sh
# assemble.sh: cut the film. Run from the repo root.
# Motion segments come from HyperFrames renders in docs/video/out/,
# real footage from docs/video/out/raw/, overlays from docs/video/out/overlays/.
set -e
cd "$(dirname "$0")/out"
FF="ffmpeg -y -loglevel error"
ENC="-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -r 30"

# The paper: slow scroll of the live page.
$FF -ss 1.8 -t 13 -i raw/paper.webm -i overlays/tag-live.png -i overlays/ov-paper.png \
  -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[b];[b][2:v]overlay[v]" \
  -map "[v]" $ENC r-paper.mp4

# The ripple: two synchronized windows side by side.
$FF -ss 2.0 -t 13 -i raw/rippleA.webm -ss 2.0 -t 13 -i raw/rippleB.webm \
  -i overlays/tag-live.png -i overlays/ov-ripple.png \
  -filter_complex "[0:v]fps=30[l];[1:v]fps=30[r];[l][r]hstack[a];[a]scale=1920:1080:flags=lanczos[b];[b][2:v]overlay[c];[c][3:v]overlay[v]" \
  -map "[v]" $ENC r-ripple.mp4

# The lenses, one at a time.
$FF -ss 1.8 -t 5.5 -i raw/timeline.webm -i overlays/tag-timeline.png -i overlays/ov-lenses.png \
  -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[b];[b][2:v]overlay[v]" \
  -map "[v]" $ENC r-timeline.mp4
$FF -ss 1.8 -t 6 -i raw/quilt.webm -i overlays/tag-quilt.png \
  -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[v]" \
  -map "[v]" $ENC r-quilt.mp4
$FF -ss 1.6 -t 6.5 -i raw/swatch.webm -i overlays/tag-swatch.png \
  -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[v]" \
  -map "[v]" $ENC r-swatch.mp4
$FF -ss 1.6 -t 7.5 -i raw/console.webm -i overlays/tag-console.png \
  -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[v]" \
  -map "[v]" $ENC r-console.mp4

# The cut, in script order.
$FF -i m1.mp4 -i m2.mp4 -i r-paper.mp4 -i r-ripple.mp4 -i m3.mp4 -i m4.mp4 \
  -i r-timeline.mp4 -i r-quilt.mp4 -i r-swatch.mp4 -i r-console.mp4 \
  -i m5.mp4 -i m6.mp4 -i m7.mp4 \
  -filter_complex "concat=n=13:v=1:a=0[v]" -map "[v]" $ENC hypernormal-apps.mp4

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 hypernormal-apps.mp4
