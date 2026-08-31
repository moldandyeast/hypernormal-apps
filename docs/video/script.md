# hypernormal apps · the film

A silent film. The narrator is the typography: Geist Mono, the site's muted
greys, the site's own grammar. Solid panels are real output, dashed is
illustration, # is commentary. Two kinds of material and they are never mixed:
motion segments written as HTML and rendered frame by frame, and real footage
of the live site captured in a browser. 1920x1080, 30 fps, about two minutes,
no sound.

Every look shown in the real footage is really happening on
hypernormal.moldandyeast.com while the camera rolls; seq numbers on screen are
the production date's truth, not props.

---

## 01 · title (0:00 to 0:07) · motion

Black. The wordmark types on, a grey cursor block blinking after it:

> hypernormal apps ▮

Below, faded in:

> durable faceless apps. a white paper that runs.

## 02 · the claim (0:07 to 0:17) · motion

Lines arrive one at a time, muted grey:

> mobile, tablet, desktop were breakpoints.
> now the breakpoint is context:
> device. situation. attention. ability. whether the user is human at all.

Then the chapter title, brighter:

> there is no perfect interface.

## 03 · the paper (0:17 to 0:30) · REAL

Corner tag: "live · hypernormal.moldandyeast.com". A slow scroll down the
real page: the wordmark, the controls, the map of the three doors, into
chapter 01 and the fraud scene, on to chapter 02 where the state panel shows
the live JSON. As much of the actual site as the pacing allows.

Overlay, lower third:

> a white paper that runs. every solid panel is live.

## 05 · the ripple (0:38 to 0:52) · REAL

Corner tag: "live · hypernormal.moldandyeast.com". Two browser windows side
by side, both on the home page. The cursor clicks dark in the left window.
Both windows change in the same instant. Then an accent. The seq number ticks
up in both mastheads.

Overlay, lower third:

> change it, and every open copy of this page follows.

## 06 · the hood (0:52 to 1:01) · motion

Title: **nothing is hidden.**

The verb, verbatim, typing on in a solid panel:

> description  "Set the site to light or dark. Everyone sees it change."
> ctx.state.mode = ctx.input.mode;
> ctx.state.seq  = (ctx.state.seq ?? 0) + 1;
> return { mode: ctx.state.mode, seq: ctx.state.seq };

> \# the whole program of a verb, exactly as it runs in production. read it before you trust it.

## 07 · the tools (1:01 to 1:15) · motion

Title: **verbs become tools.**

> \> document.modelContext.getTools() → set_mode · set_accent · set_radius · reset

A session, dashed:

> you     "make it teal and round"
>         tool call  set_accent { "accent": "teal" }
>         tool call  set_radius { "radius": "round" }
> agent   done. every open copy of this page just changed.

> \# webmcp. nothing was installed, no account exists, no sdk was needed.

## 08 · the lenses (1:15 to 1:35) · REAL

Quick cuts, each a few seconds, each tagged with its path:

1. /f/timeline · the list of every look, newest first
2. /f/quilt · the memory as one picture
3. /f/swatch · the page is the accent; a tap advances it, for everyone
4. /f/console · a verb typed, a result returned, state streaming

Overlay between cuts:

> one app, many lenses. none of them is the app.

## 09 · the derived (1:35 to 1:47) · motion

Title: **vibe code a face of your own.**

The prompt types on in a solid panel with a copy chip:

> "read hypernormal.moldandyeast.com/a/07e641…8c158
>  and build me a better timeline than the one this
>  site ships. the charter tells you everything."

> \# yes, we are inviting you to beat our own face.

## 10 · the heartbeat (1:47 to 1:56) · motion

Quiet. One line at a time:

> at midnight utc the site resets itself.
> one change each day, made by no one.
> the memory records it like any other.

## 11 · fork it (1:56 to 2:06) · motion

> this site is its own white paper.
> the proof is that it runs.

> github.com/moldandyeast/hypernormal-apps
> hypernormal.moldandyeast.com

Last line, in the live accent, cursor blinking:

> an empty URL is waiting ▮

---

## production notes

- Motion segments: HyperFrames compositions in `docs/video/segments/`,
  rendered deterministically to MP4 in headless Chrome.
- Real segments: Playwright captures of the live site; the two-window ripple
  is two synchronized recordings composed side by side with FFmpeg. Nothing
  in them is staged beyond the clicking.
- Assembly: FFmpeg concat, 1920x1080, 30 fps, H.264, silent.
