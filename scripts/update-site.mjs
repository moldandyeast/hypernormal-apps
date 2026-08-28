#!/usr/bin/env node
// update-site.mjs: push the site's words and faces to an already-seeded
// installation, in place. Reads the ids seed-site.mjs wrote to .site-ids;
// never mints. The page app's state is replaced with site/page.state.json
// (the seed act), and the three faces are re-registered from site/*.html.
//
// Usage:
//   node scripts/update-site.mjs                    # against the base in .site-ids
//   HN_BASE=https://other.example node scripts/update-site.mjs
//
// Owner key: $HN_KEY if set, else the gitignored .owner-key file.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ids = JSON.parse(readFileSync(join(root, ".site-ids"), "utf8"));
const BASE = (process.env.HN_BASE ?? ids.base).replace(/\/$/, "");

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
const substitute = (html) =>
  html.replaceAll("__PAGE_ID__", ids.page).replaceAll("__LOOK_ID__", ids.look).replaceAll("__LOG_ID__", ids.log);

await call("PUT", `/a/${ids.page}/state`, JSON.parse(site("page.state.json")));
console.log(`words:    ${BASE}/a/${ids.page}/state replaced from site/page.state.json`);

await call("PUT", "/f/home", { name: "home", title: "hypernormal apps", html: substitute(site("home.html")), targets: [ids.page, ids.look, ids.log], visibility: "public" });
console.log(`face:     ${BASE}/f/home  (served at ${BASE}/ for browsers)`);
await call("PUT", "/f/timeline", { name: "timeline", title: "The memory: timeline", html: site("timeline.html"), targets: [ids.log], visibility: "public" });
console.log(`face:     ${BASE}/f/timeline?app=/a/${ids.log}`);
await call("PUT", "/f/stats", { name: "stats", title: "The memory: stats", html: site("stats.html"), targets: [ids.log], visibility: "public" });
console.log(`face:     ${BASE}/f/stats?app=/a/${ids.log}`);
