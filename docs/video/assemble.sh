#!/bin/sh
# assemble.sh: cut the film, second cut. Run from anywhere.
# but/therefore connectors between every act, trimmed to 0.6s.
set -e
cd "$(dirname "$0")/out"
FF="ffmpeg -y -loglevel error"
ENC="-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -r 30"

real () { # name src ss t tag [lower]
  if [ -n "$6" ]; then
    $FF -ss "$3" -t "$4" -i "raw/$2" -i "overlays/$5.png" -i "overlays/$6.png" \
      -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[b];[b][2:v]overlay[v]" \
      -map "[v]" $ENC "r-$1.mp4"
  else
    $FF -ss "$3" -t "$4" -i "raw/$2" -i "overlays/$5.png" \
      -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos[a];[a][1:v]overlay[v]" \
      -map "[v]" $ENC "r-$1.mp4"
  fi
}

real charter  charter.webm  2.0 6   tag-live     ov-charter
real tlcut    timeline.webm 3.0 2.2 tag-timeline ov-faces
real quiltcut quilt.webm    3.0 2.2 tag-quilt    ov-faces
real swatch2  swatch.webm   3.0 2.6 tag-swatch   ov-none
real console2 console.webm  3.2 6   tag-console
real quilt2   quilt2.webm   1.5 7   tag-live     ov-receipts

$FF -ss 2.5 -t 8 -i raw/rippleA.webm -ss 2.5 -t 8 -i raw/rippleB.webm \
  -i overlays/tag-live.png -i overlays/ov-ripple.png \
  -filter_complex "[0:v]fps=30[l];[1:v]fps=30[r];[l][r]hstack[a];[a]scale=1920:1080:flags=lanczos[b];[b][2:v]overlay[c];[c][3:v]overlay[v]" \
  -map "[v]" $ENC r-ripple.mp4

# The cut. but/therefore cards trimmed to 0.6s each.
$FF \
  -i b1.mp4 -t 0.6 -i but.mp4 -i b2.mp4 -t 0.6 -i therefore.mp4 \
  -i b3.mp4 -t 0.6 -i but.mp4 -i b4.mp4 -t 0.6 -i therefore.mp4 \
  -i b5.mp4 -i r-charter.mp4 -t 0.6 -i but.mp4 \
  -i b6.mp4 -i r-ripple.mp4 -i r-tlcut.mp4 -i r-quiltcut.mp4 -i r-swatch2.mp4 \
  -t 0.6 -i but.mp4 -i b7.mp4 -i r-console2.mp4 \
  -t 0.6 -i but.mp4 -i b8.mp4 \
  -t 0.6 -i but.mp4 -i b9.mp4 -i r-quilt2.mp4 \
  -t 0.6 -i therefore.mp4 -i b10.mp4 \
  -filter_complex "concat=n=26:v=1:a=0[v]" -map "[v]" $ENC hypernormal-apps.mp4

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 hypernormal-apps.mp4
