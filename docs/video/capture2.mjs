#!/usr/bin/env node
// capture2.mjs: the two extra shots for the second cut.
// Usage: node docs/video/capture2.mjs <playwright-module-path> <out-dir>

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

async function record(name, run) {
  const size = { width: 1920, height: 1080 };
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
  const page = await ctx.newPage();
  await run(page, ctx);
  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), join(outDir, `${name}.webm`));
  console.log(`recorded ${name}.webm`);
}

// The charter, close up: chapter 03's curl panel on the live page.
await record("charter", async (page) => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => { document.body.style.zoom = "1.35"; });
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelector('[layer-name], #ch-separation, section#ch-separation')
      ?.scrollIntoView();
    const panel = document.getElementById("x-charter");
    panel?.closest("div")?.scrollIntoView({ block: "center" });
  });
  await sleep(7000);
});

// The quilt, tight, with a stitch arriving live while the camera rolls.
await record("quilt2", async (page, ctx) => {
  await page.goto(`${SITE}/f/quilt?app=/a/${LOG}`, { waitUntil: "networkidle" });
  await page.evaluate(() => { document.body.style.zoom = "1.5"; });
  await sleep(3000);
  const other = await ctx.newPage();
  await other.goto(`${SITE}/f/swatch?app=/a/${LOOK}`, { waitUntil: "networkidle" });
  await sleep(800);
  await other.click("body");
  await other.close();
  await page.bringToFront();
  await sleep(4500);
});

await browser.close();
console.log("done");
