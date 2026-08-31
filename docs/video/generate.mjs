#!/usr/bin/env node
// generate.mjs: emit the film's motion segments (second cut) as HyperFrames
// compositions, plus the transparent overlays for the real footage.
//
// The cut runs on but/therefore: every beat forced by the one before it,
// the connectors visible as full-frame cards.
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
  .stage { width: 1920px; height: 1080px; display: flex; flex-direction: column; justify-content: center; padding: 0 320px; gap: 26px; }
  .center { align-items: center; text-align: center; }
  .big { font-size: 52px; font-weight: 500; color: ${C.fg}; line-height: 1.35; }
  .title { font-size: 44px; font-weight: 500; color: ${C.fg}; line-height: 1.3; }
  .line { font-size: 30px; line-height: 1.6; }
  .dim { color: ${C.label}; }
  .out { color: ${C.fg}; }
  .comment { font-size: 24px; color: ${C.comment}; }
  .panel { border: 1px solid ${C.line}; background: ${C.panel}; padding: 34px 40px; font-size: 25px; line-height: 1.7; }
  .panel.scene { border-style: dashed; border-color: #3A3A3A; background: transparent; }
  pre { font: inherit; white-space: pre-wrap; }
  .cursor { display: inline-block; width: 0.5em; height: 0.95em; vertical-align: text-bottom; }
  .accent { color: ${C.accent}; }
  .fadein { opacity: 0; }
  .word { font-size: 72px; font-weight: 500; }
  .mockui { width: 860px; }
  .mock-head { display: flex; gap: 10px; margin-bottom: 24px; }
  .mock-head i { width: 14px; height: 14px; border-radius: 7px; background: ${C.line}; display: block; }
  .mock-title { font-size: 26px; color: ${C.fg}; margin-bottom: 18px; }
  .mock-chips { display: flex; gap: 14px; margin-bottom: 26px; }
  .mock-chips span { border: 1px solid ${C.label}; padding: 6px 18px; font-size: 20px; color: ${C.fg}; }
  .mock-bars { display: flex; gap: 12px; align-items: flex-end; height: 120px; }
  .mock-bars i { width: 42px; display: block; background: ${C.accent}; opacity: .85; }
  .variant { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 320px; }
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
  function fade(sel, at, dur = 0.6) {
    tl.fromTo(sel, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: dur, ease: "power2.out" }, at);
  }
  function cut(sel, at, show) {
    tl.set(sel, { opacity: show ? 1 : 0 }, at);
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

const MOCK = `
  <div class="mockui">
    <div class="mock-head"><i></i><i></i><i></i></div>
    <div class="mock-title">expenses · march</div>
    <div class="mock-chips"><span>add</span><span>filter</span><span>export</span></div>
    <div class="mock-bars"><i style="height: 46px;"></i><i style="height: 92px;"></i><i style="height: 64px;"></i><i style="height: 118px;"></i><i style="height: 82px;"></i></div>
  </div>`;

const segments = {
  // beat 1: the setup.
  b1: page("b1", 8, `
    <div class="stage">
      <div class="big fadein" id="l1">you built an app.</div>
      <div class="big fadein" id="l2">you designed its face. it is perfect.</div>
      <div class="panel scene fadein" id="p" style="margin-top: 20px;">${MOCK}</div>
    </div>`, `
  fade("#l1", 0.4); fade("#l2", 1.6); fade("#p", 3.0, 0.8);
`),

  // beat 2: the contexts. the perfect face collapses three times.
  b2: page("b2", 9, `
    <div class="variant" id="v0"><div class="line dim" id="c0">&nbsp;</div><div class="panel scene" style="margin-top: 20px;">${MOCK}</div></div>
    <div class="variant" id="v1" style="opacity: 0;"><div class="line dim">your user is driving.</div><div class="big" style="margin-top: 40px;">blocked. we will talk later.</div></div>
    <div class="variant" id="v2" style="opacity: 0;"><div class="line dim">your user cannot see.</div><div class="line out" style="margin-top: 40px;">expenses, march. five entries. add, filter, export.<br>spoken, in order, nothing more.</div></div>
    <div class="variant" id="v3" style="opacity: 0;"><div class="line dim">your user is not human.</div><pre class="line out" style="margin-top: 40px;">{ "month": "march", "entries": 5, "verbs": ["add", "filter", "export"] }</pre></div>`, `
  cut("#v0", 0, true);
  cut("#v0", 2.2, false); cut("#v1", 2.2, true);
  cut("#v1", 4.6, false); cut("#v2", 4.6, true);
  cut("#v2", 7.0, false); cut("#v3", 7.0, true);
`),

  // beat 3: the claim.
  b3: page("b3", 5, `
    <div class="stage center">
      <div class="big fadein" id="l1">there is no perfect interface.</div>
      <div class="big fadein" id="l2">there are contexts.</div>
    </div>`, `
  fade("#l1", 0.4); fade("#l2", 1.8);
`),

  // beat 4: the villain.
  b4: page("b4", 7, `
    <div class="stage">
      <div class="big fadein" id="l1">every app ships exactly one face.</div>
      <div class="big fadein" id="l2">welded on.</div>
      <div class="line fadein" id="l3" style="margin-top: 16px;">therefore everyone lives in someone else's compromise.</div>
    </div>`, `
  fade("#l1", 0.4); fade("#l2", 1.8); fade("#l3", 3.4);
`),

  // beat 5: the separation. the church drifts off; the state remains.
  b5: page("b5", 8, `
    <div class="stage">
      <div class="big fadein" id="t">separate the face from the app.</div>
      <div style="display: flex; gap: 28px; margin-top: 24px;">
        <div class="panel scene fadein" id="church" style="flex: 1;"><span class="out" style="font-weight: 500;">the church</span><br><span class="dim" style="font-size: 21px;">faces, chats, widgets, voices. disposable, anyone's.</span></div>
        <div class="panel fadein" id="state" style="flex: 1; border-color: ${C.label};"><span class="out" style="font-weight: 500;">the state</span><br><span class="dim" style="font-size: 21px;">a charter and a state, at one url, manual baked in.</span></div>
      </div>
      <div class="comment fadein" id="c"># what remains is the app itself.</div>
    </div>`, `
  fade("#t", 0.3); fade("#church", 1.4); fade("#state", 1.4);
  tl.to("#church", { x: -700, opacity: 0, duration: 1.4, ease: "power2.in" }, 3.6);
  fade("#c", 5.4);
`),

  // beat 6 opener: the objection, answered.
  b6: page("b6", 5, `
    <div class="stage center">
      <div class="big fadein" id="l1">an app with no face is useless.</div>
      <div class="big fadein" id="l2">therefore anyone may give it one.</div>
    </div>`, `
  fade("#l1", 0.4); fade("#l2", 2.2);
`),

  // beat 7 opener: the agent.
  b7: page("b7", 7, `
    <div class="stage">
      <div class="big fadein" id="t">your agent does not want a face at all.</div>
      <div class="line dim" style="margin-top: 16px;"><span id="gt"></span></div>
      <div class="comment fadein" id="c"># its verbs become your agent's tools the moment you arrive. nothing installed. no account. no sdk.</div>
    </div>`, `
  fade("#t", 0.4);
  type("#gt", ${T("> document.modelContext.getTools() → set_mode · set_accent · set_radius · reset")}, 1.8, 2.2);
  fade("#c", 4.6);
`),

  // beat 8: the trust problem.
  b8: page("b8", 9, `
    <div class="stage">
      <div class="big fadein" id="l1">anyone can act on it.</div>
      <div class="big fadein" id="l2">why would you trust it?</div>
      <div class="panel fadein" id="p" style="margin-top: 12px;"><pre class="out" id="code"></pre></div>
      <div class="comment fadein" id="c"># nothing is hidden. read it before you trust it.</div>
    </div>`, `
  fade("#l1", 0.3); fade("#l2", 1.4);
  fade("#p", 2.8);
  type("#code", ${T('ctx.state.mode = ctx.input.mode;\nctx.state.seq  = (ctx.state.seq ?? 0) + 1;\nreturn { mode: ctx.state.mode, seq: ctx.state.seq };')}, 3.2, 2.8);
  fade("#c", 6.6);
`),

  // beat 9 opener: the doubter.
  b9: page("b9", 4, `
    <div class="stage center">
      <div class="big fadein" id="l1">surely this is a demo.</div>
      <div class="big fadein" id="l2">surely nothing is really running.</div>
    </div>`, `
  fade("#l1", 0.3); fade("#l2", 1.6);
`),

  // beat 10: the close. the name arrives only now.
  b10: page("b10", 12, `
    <div class="stage">
      <div class="title" style="font-size: 88px;"><span id="wm"></span><span class="cursor" id="cur" style="background: ${C.label}; opacity: .5;"></span></div>
      <div class="line fadein" id="claim">durable faceless apps. a white paper that runs.</div>
      <div class="line out fadein" id="links" style="margin-top: 24px; text-decoration: underline; text-underline-offset: 6px;">github.com/moldandyeast/hypernormal-apps&nbsp;&nbsp;·&nbsp;&nbsp;hypernormal.moldandyeast.com</div>
      <div class="line accent" style="margin-top: 24px; font-size: 30px;"><span id="wait"></span><span class="cursor" id="cur2" style="background: ${C.accent}; margin-left: 6px;"></span></div>
    </div>`, `
  type("#wm", ${T("hypernormal apps ")}, 0.4, 1.6);
  blink("#cur", 2.1, 4);
  fade("#claim", 2.6);
  fade("#links", 4.0);
  type("#wait", ${T("an empty URL is waiting ")}, 5.4, 1.5);
  blink("#cur2", 5.4, 6);
`),

  // the connectors.
  but: page("but", 1, `
    <div class="stage center"><div class="word dim">but.</div></div>`, ``),
  therefore: page("therefore", 1, `
    <div class="stage center"><div class="word out">therefore.</div></div>`, ``),
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

// Overlays for the real footage.
const tag = (text) => `<div style="position: absolute; top: 8px; right: 24px; font-size: 22px; color: ${C.label}; background: rgba(10,10,10,.55); padding: 8px 18px;">${text}</div>`;
const lower = (html) => `<div style="position: absolute; bottom: 56px; left: 0; width: 1920px; text-align: center;"><span style="display: inline-block; font-size: 30px; line-height: 1.5; color: ${C.fg}; background: rgba(10,10,10,.72); padding: 14px 28px;">${html}</span></div>`;

const overlaySpecs = {
  "tag-live": tag("● live · hypernormal.moldandyeast.com"),
  "tag-timeline": tag("/f/timeline"),
  "tag-quilt": tag("/f/quilt"),
  "tag-swatch": tag("/f/swatch · anyone may tap"),
  "tag-console": tag("/f/console · a repl over any app"),
  "ov-charter": lower("the whole contract, from one request."),
  "ov-ripple": lower("one click. every open copy of this page follows."),
  "ov-faces": lower("this is one face. this is another. and another."),
  "ov-none": lower("none of them is the app."),
  "ov-receipts": lower("every stitch a stranger, recorded exactly once.<br>at midnight utc it resets itself. no one is there when it happens."),
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
