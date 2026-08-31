#!/usr/bin/env node
// capture.mjs: record the real site for the film. Nothing here is staged
// beyond the clicking; every recording is the live installation.
//
// Usage: node docs/video/capture.mjs <playwright-module-path> <out-dir>

import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const [pwPath, outDir] = process.argv.slice(2);
const { chromium } = await import(pwPath);
mkdirSync(outDir, { recursive: true });

const SITE = "https://hypernormal.moldandyeast.com";
const LOOK = "9dc4dd92664743ed196a00448b38f5d4bbf729c354b3919661697295e6736dce";
const LOG = "07e641d60a0498ea2825a4a81303f3fbbb6195aab947d568309d848ced78c158";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();

async function record(name, size, run) {
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
  const page = await ctx.newPage();
  await run(page, ctx);
  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), join(outDir, `${name}.webm`));
  console.log(`recorded ${name}.webm`);
}

// 03 · the paper: a slow scroll through the white paper.
await record("paper", { width: 1920, height: 1080 }, async (page) => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await sleep(2500);
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y <= 2600; y += 8) { window.scrollTo(0, y); await sleep(30); }
  });
  await sleep(1200);
});

// 05 · the ripple: two windows, one click, both follow.
{
  const size = { width: 960, height: 1080 };
  const ctxA = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
  const ctxB = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await Promise.all([
    a.goto(`${SITE}/`, { waitUntil: "networkidle" }),
    b.goto(`${SITE}/`, { waitUntil: "networkidle" }),
  ]);
  await sleep(3000);
  await a.click("#mode-dark");
  await sleep(3000);
  await a.click('.swatch[data-accent="teal"]');
  await sleep(3000);
  await a.click('[data-radius="round"]');
  await sleep(3500);
  const va = a.video(), vb = b.video();
  await ctxA.close(); await ctxB.close();
  renameSync(await va.path(), join(outDir, "rippleA.webm"));
  renameSync(await vb.path(), join(outDir, "rippleB.webm"));
  console.log("recorded rippleA.webm rippleB.webm");
}

// 08 · the lenses, one at a time.
await record("timeline", { width: 1920, height: 1080 }, async (page) => {
  await page.goto(`${SITE}/f/timeline?app=/a/${LOG}`, { waitUntil: "networkidle" });
  await sleep(2500);
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y <= 500; y += 5) { window.scrollTo(0, y); await sleep(24); }
  });
  await sleep(800);
});

await record("quilt", { width: 1920, height: 1080 }, async (page, ctx) => {
  await page.goto(`${SITE}/f/quilt?app=/a/${LOG}`, { waitUntil: "networkidle" });
  await sleep(3000);
  // A second visitor taps the swatch; a new stitch arrives in the quilt, live.
  const other = await ctx.newPage();
  await other.goto(`${SITE}/f/swatch?app=/a/${LOOK}`, { waitUntil: "networkidle" });
  await sleep(1000);
  await other.click("body");
  await other.close();
  await page.bringToFront();
  await sleep(3500);
});

await record("swatch", { width: 1920, height: 1080 }, async (page) => {
  await page.goto(`${SITE}/f/swatch?app=/a/${LOOK}`, { waitUntil: "networkidle" });
  await sleep(2500);
  for (let i = 0; i < 3; i++) { await page.click("body"); await sleep(1800); }
  await sleep(800);
});

await record("console", { width: 1920, height: 1080 }, async (page) => {
  await page.goto(`${SITE}/f/console?app=/a/${LOOK}`, { waitUntil: "networkidle" });
  await sleep(2500);
  await page.click("#cmd");
  await page.type("#cmd", 'set_accent {"accent": "teal"}', { delay: 55 });
  await sleep(700);
  await page.press("#cmd", "Enter");
  await sleep(3200);
});

await browser.close();
console.log("all captures done");
