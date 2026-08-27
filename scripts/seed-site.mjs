#!/usr/bin/env node
// seed-site.mjs: mint the site constellation (page, look, log) and register
// its faces (home, timeline, stats) on a Hypernormal installation.
//
// Usage:
//   node scripts/seed-site.mjs                # against http://localhost:8787
//   HN_BASE=https://hypernormal.example node scripts/seed-site.mjs
//
// Owner key: $HN_KEY if set, else the gitignored .owner-key file in the repo
// root. Writes the minted ids to .site-ids (gitignored) and refuses to run
// again while that file exists; re-seeding is deliberate, not accidental.
// Pass --force to re-seed anyway (mints fresh apps; the old ones remain until
// retired).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.HN_BASE ?? "http://localhost:8787").replace(/\/$/, "");
const idsFile = join(root, ".site-ids");

if (existsSync(idsFile) && !process.argv.includes("--force")) {
  console.error(`Refusing to seed: ${idsFile} exists. Pass --force to mint a fresh constellation.`);
  process.exit(2);
}

const key = process.env.HN_KEY ?? readFileSync(join(root, ".owner-key"), "utf8").trim();
const authed = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: authed, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${json.error ?? "unknown error"}`);
  }
  return json;
}

const site = (name) => readFileSync(join(root, "site", name), "utf8");
const mintBody = (stem) => ({ charter: JSON.parse(site(`${stem}.charter.json`)), state: JSON.parse(site(`${stem}.state.json`)) });

const { id: pageId } = await call("POST", "/apps", mintBody("page"));
console.log(`page app: ${BASE}/a/${pageId}`);
const { id: lookId } = await call("POST", "/apps", mintBody("look"));
console.log(`look app: ${BASE}/a/${lookId}`);
const { id: logId } = await call("POST", "/apps", mintBody("log"));
console.log(`log app:  ${BASE}/a/${logId}`);

const substitute = (html) =>
  html.replaceAll("__PAGE_ID__", pageId).replaceAll("__LOOK_ID__", lookId).replaceAll("__LOG_ID__", logId);

await call("PUT", "/f/home", { name: "home", title: "Hypernormal", html: substitute(site("home.html")), targets: [pageId, lookId, logId], visibility: "public" });
console.log(`face:     ${BASE}/f/home  (served at ${BASE}/ for browsers)`);
await call("PUT", "/f/timeline", { name: "timeline", title: "The memory: timeline", html: site("timeline.html"), targets: [logId], visibility: "public" });
console.log(`face:     ${BASE}/f/timeline?app=/a/${logId}`);
await call("PUT", "/f/stats", { name: "stats", title: "The memory: stats", html: site("stats.html"), targets: [logId], visibility: "public" });
console.log(`face:     ${BASE}/f/stats?app=/a/${logId}`);

writeFileSync(idsFile, JSON.stringify({ base: BASE, page: pageId, look: lookId, log: logId }, null, 2) + "\n");
console.log(`ids written to ${idsFile}`);
