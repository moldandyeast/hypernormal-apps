#!/usr/bin/env node
// generate.mjs: emit the film's motion segments as HyperFrames compositions,
// and the transparent overlays that sit on the real footage.
//
// Usage: node docs/video/generate.mjs <playwright-module-path>

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const segDir = join(here, "segments");
const ovDir = join(here, "out", "overlays");
mkdirSync(segDir, { recursive: true });
mkdirSync(ovDir, { recursive: true });

// The film's palette is the site's dark set, accent teal: the look the site
// wore on the day of shooting.
const C = {
  bg: "#0A0A0A", fg: "#C6CAD0", body: "#8F949C", label: "#6B717A",
  comment: "#767C84", line: "#262626", panel: "#0F0F0F", accent: "#63E6BE",
};

const page = (id, duration, bodyHtml, timelineJs) => `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${C.bg}; }
  body { font-family: "Geist Mono", monospace; color: ${C.body}; }
  .stage { width: 1920px; height: 1080px; display: flex; flex-direction: column; justify-content: center; padding: 0 320px; gap: 28px; }
  .title { font-size: 46px; font-weight: 500; color: ${C.fg}; line-height: 1.25; }
  .line { font-size: 28px; line-height: 1.6; }
  .dim { color: ${C.label}; }
  .out { color: ${C.fg}; }
  .comment { font-size: 24px; color: ${C.comment}; }
  .panel { border: 1px solid ${C.line}; background: ${C.panel}; padding: 36px 40px; font-size: 25px; line-height: 1.7; }
  .panel.scene { border-style: dashed; border-color: #3A3A3A; background: transparent; }
  .panelhead { display: flex; justify-content: space-between; align-items: baseline; }
  .tag { font-size: 19px; color: ${C.label}; }
  pre { font: inherit; white-space: pre-wrap; }
  .lane { display: flex; gap: 32px; align-items: baseline; margin-top: 14px; }
  .lane .who { color: ${C.label}; width: 130px; flex-shrink: 0; }
  .lane .say { color: ${C.fg}; }
  .cursor { display: inline-block; width: 0.5em; height: 0.95em; vertical-align: text-bottom; }
  .accent { color: ${C.accent}; }
  .fadein { opacity: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="${id}" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
${bodyHtml}
</div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  function type(sel, text, at, dur) {
    const el = document.querySelector(sel);
    el.textContent = "";
    const st = { n: 0 };
    tl.to(st, { n: text.length, duration: dur, ease: "none",
      onUpdate: () => { el.textContent = text.slice(0, Math.round(st.n)); } }, at);
  }
  function fade(sel, at, dur = 0.7) {
    tl.fromTo(sel, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: dur, ease: "power2.out" }, at);
  }
  function blink(sel, at, cycles) {
    tl.to(sel, { opacity: 0, duration: 0.45, yoyo: true, repeat: cycles * 2, ease: "steps(1)" }, at);
  }
${timelineJs}
  window.__timelines["${id}"] = tl;
</script>
</body>
</html>
`;

const T = (s) => JSON.stringify(s);

const segments = {
  m1: page("m1", 7, `
    <div class="stage" style="align-items: flex-start;">
      <div class="title" style="font-size: 96px;"><span id="wm"></span><span class="cursor" id="cur" style="background: ${C.label}; opacity: .5;"></span></div>
      <div class="line fadein" id="claim">durable faceless apps. a white paper that runs.</div>
    </div>`, `
  type("#wm", ${T("hypernormal apps ")}, 0.3, 1.7);
  blink("#cur", 2.0, 5);
  fade("#claim", 2.6);
`),

  m2: page("m2", 10, `
    <div class="stage">
      <div class="line fadein" id="l1">mobile, tablet, desktop were breakpoints.</div>
      <div class="line fadein" id="l2">now the breakpoint is context:</div>
      <div class="line fadein" id="l3">device. situation. attention. ability. whether the user is human at all.</div>
      <div class="title" style="margin-top: 36px;"><span id="t"></span></div>
    </div>`, `
  fade("#l1", 0.4); fade("#l2", 1.7); fade("#l3", 3.0);
  type("#t", ${T("there is no perfect interface.")}, 5.0, 1.8);
`),

  m3: page("m3", 9, `
    <div class="stage">
      <div class="title fadein" id="t">nothing is hidden.</div>
      <div class="panel fadein" id="p">
        <div class="dim">$ curl hypernormal.moldandyeast.com/a/9dc4dd…736dce</div>
        <div class="dim" style="margin-top: 10px;">description  "Set the site to light or dark. Everyone sees it change."</div>
        <pre class="out" id="code" style="margin-top: 10px;"></pre>
      </div>
      <div class="comment fadein" id="c"># the whole program of a verb, exactly as it runs in production. read it before you trust it.</div>
    </div>`, `
  fade("#t", 0.3); fade("#p", 1.1);
  type("#code", ${T('ctx.state.mode = ctx.input.mode;\nctx.state.seq  = (ctx.state.seq ?? 0) + 1;\nreturn { mode: ctx.state.mode, seq: ctx.state.seq };')}, 1.9, 3.4);
  fade("#c", 6.2);
`),

  m4: page("m4", 14, `
    <div class="stage">
      <div class="title fadein" id="t">verbs become tools.</div>
      <div class="line dim"><span id="gt"></span></div>
      <div class="panel scene fadein" id="p">
        <div class="panelhead"><span class="dim">a session</span><span class="tag">an illustration; the tools are real</span></div>
        <div class="lane"><span class="who">you</span><span class="say" id="you"></span></div>
        <div class="lane fadein" id="tc1"><span class="who"></span><span class="dim">tool call&nbsp; set_accent { "accent": "teal" }</span></div>
        <div class="lane fadein" id="tc2"><span class="who"></span><span class="dim">tool call&nbsp; set_radius { "radius": "round" }</span></div>
        <div class="lane"><span class="who">agent</span><span class="say" id="ag"></span></div>
      </div>
      <div class="comment fadein" id="c"># webmcp. nothing was installed, no account exists, no sdk was needed.</div>
    </div>`, `
  fade("#t", 0.3);
  type("#gt", ${T("> document.modelContext.getTools() → set_mode · set_accent · set_radius · reset")}, 1.2, 2.2);
  fade("#p", 4.0);
  type("#you", ${T('"make it teal and round"')}, 4.6, 1.1);
  fade("#tc1", 6.2, 0.5); fade("#tc2", 6.9, 0.5);
  type("#ag", ${T("done. every open copy of this page just changed.")}, 7.9, 1.7);
  fade("#c", 10.6);
`),

  m5: page("m5", 12, `
    <div class="stage">
      <div class="title fadein" id="t">vibe code a face of your own.</div>
      <div class="panel fadein" id="p">
        <div class="panelhead"><span class="dim">$ paste into any agent</span><span class="tag" style="border: 1px solid ${C.line}; padding: 4px 14px;">copy</span></div>
        <pre class="out" id="pr" style="margin-top: 12px;"></pre>
      </div>
      <div class="comment fadein" id="c"># yes, we are inviting you to beat our own face. minutes later you hold your own ui.</div>
    </div>`, `
  fade("#t", 0.3); fade("#p", 1.0);
  type("#pr", ${T('"read hypernormal.moldandyeast.com/a/07e641…8c158\n and build me a better timeline than the one this\n site ships. the charter tells you everything."')}, 1.6, 4.4);
  fade("#c", 7.0);
`),

  m6: page("m6", 9, `
    <div class="stage" style="align-items: center; text-align: center;">
      <div class="title fadein" id="l1" style="font-size: 40px;">at midnight utc the site resets itself.</div>
      <div class="line fadein" id="l2">one change each day, made by no one.</div>
      <div class="line dim fadein" id="l3" style="font-size: 24px;">the memory records it like any other.</div>
    </div>`, `
  fade("#l1", 0.6, 1.0); fade("#l2", 2.6, 1.0); fade("#l3", 4.8, 1.0);
`),

  m7: page("m7", 10, `
    <div class="stage" style="align-items: flex-start;">
      <div class="title fadein" id="l1" style="font-size: 40px;">this site is its own white paper.</div>
      <div class="title fadein" id="l2" style="font-size: 40px;">the proof is that it runs.</div>
      <div class="line out fadein" id="links" style="margin-top: 30px; text-decoration: underline; text-underline-offset: 6px;">github.com/moldandyeast/hypernormal-apps&nbsp;&nbsp;·&nbsp;&nbsp;hypernormal.moldandyeast.com</div>
      <div class="line accent" style="margin-top: 30px; font-size: 30px;"><span id="wait"></span><span class="cursor" id="cur" style="background: ${C.accent}; margin-left: 6px;"></span></div>
    </div>`, `
  fade("#l1", 0.4); fade("#l2", 1.5); fade("#links", 3.0);
  type("#wait", ${T("an empty URL is waiting ")}, 4.6, 1.6);
  blink("#cur", 4.6, 5);
`),
};

for (const [name, html] of Object.entries(segments)) {
  writeFileSync(join(segDir, `${name}.html`), html);
  console.log(`segments/${name}.html`);
}

writeFileSync(join(segDir, "hyperframes.json"), JSON.stringify({
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  paths: { blocks: ".", components: "components", assets: "assets" },
  media: { autoProxy: true },
}, null, 2));
writeFileSync(join(segDir, "meta.json"), JSON.stringify({ id: "hypernormal-film", name: "hypernormal-film" }, null, 2));
writeFileSync(join(segDir, "package.json"), JSON.stringify({ name: "hypernormal-film", private: true, type: "module" }, null, 2));

// Overlays: transparent PNGs screenshotted from the same design system.
const overlaySpecs = {
  "tag-live": `<div style="position: absolute; top: 8px; right: 24px; font-size: 22px; color: ${C.label}; background: rgba(10,10,10,.55); padding: 8px 18px;">● live · hypernormal.moldandyeast.com</div>`,
  "ov-paper": `<div style="position: absolute; bottom: 64px; left: 0; width: 1920px; text-align: center;"><span style="font-size: 30px; color: ${C.fg}; background: rgba(10,10,10,.72); padding: 14px 28px;">a white paper that runs. every solid panel is live.</span></div>`,
  "ov-ripple": `<div style="position: absolute; bottom: 64px; left: 0; width: 1920px; text-align: center;"><span style="font-size: 30px; color: ${C.fg}; background: rgba(10,10,10,.72); padding: 14px 28px;">change it, and every open copy of this page follows.</span></div>`,
  "ov-lenses": `<div style="position: absolute; bottom: 64px; left: 0; width: 1920px; text-align: center;"><span style="font-size: 30px; color: ${C.fg}; background: rgba(10,10,10,.72); padding: 14px 28px;">one app, many lenses. none of them is the app.</span></div>`,
  "tag-timeline": `<div style="position: absolute; top: 8px; right: 24px; font-size: 22px; color: ${C.label}; background: rgba(10,10,10,.55); padding: 8px 18px;">/f/timeline</div>`,
  "tag-quilt": `<div style="position: absolute; top: 8px; right: 24px; font-size: 22px; color: ${C.label}; background: rgba(10,10,10,.55); padding: 8px 18px;">/f/quilt</div>`,
  "tag-swatch": `<div style="position: absolute; top: 8px; right: 24px; font-size: 22px; color: ${C.label}; background: rgba(10,10,10,.55); padding: 8px 18px;">/f/swatch · anyone may tap</div>`,
  "tag-console": `<div style="position: absolute; top: 8px; right: 24px; font-size: 22px; color: ${C.label}; background: rgba(10,10,10,.55); padding: 8px 18px;">/f/console · a repl over any app</div>`,
};

const pwPath = process.argv[2];
if (pwPath) {
  const { chromium } = await import(pwPath);
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, html] of Object.entries(overlaySpecs)) {
    await pg.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet"><style>* { margin: 0; font-family: "Geist Mono", monospace; }</style></head><body style="width: 1920px; height: 1080px; background: transparent;">${html}</body></html>`, { waitUntil: "networkidle" });
    await pg.screenshot({ path: join(ovDir, `${name}.png`), omitBackground: true });
    console.log(`overlays/${name}.png`);
  }
  await browser.close();
}
