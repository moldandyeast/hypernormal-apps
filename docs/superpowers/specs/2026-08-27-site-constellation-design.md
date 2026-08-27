# The site constellation

Status: approved in discussion, 2026-08-27. The demo layer's first piece: the
public site at hypernormal.moldandyeast.com, built as Hypernormal apps.

## The idea

The site is not a brochure about the platform; it is an instance of it. Three
apps, composing through nothing but their public doors:

- **The page app.** State holds the site's words: what Hypernormal is, how it
  works, the idea. The home face renders them.
- **The look app.** State holds the site's design: mode, accent, radius, and a
  running change number. Its verbs are palette-constrained: no verb can express
  a broken look. Anyone can change the look; everyone sees it change at the
  same instant.
- **The log app.** State holds the memory: a capped list of look-change
  snapshots. Several small faces render it differently (timeline, stats),
  demonstrating one app, many views.

The home face reads the page app and the look app the way any stranger's face
would: ordinary charter fetch, ordinary WebSocket, ordinary verbs, and (same
origin) WebMCP tool registration. Nothing privileged anywhere.

## The three charters

**look** — state `{mode, accent, radius, seq}`.
- `set_mode({mode})`, `set_accent({accent})`, `set_radius({radius})`,
  `reset()` — all `public`, all bump `seq` by one.
- Guardrails live in the `inputSchema`: `mode` is an enum of `light|dark`,
  `accent` an enum of six curated names, `radius` an enum of `sharp|soft|round`.
  Out-of-palette input is rejected by schema validation before the code runs.
- The intent documents the palette's actual values (hex per accent per mode,
  px per radius) so any face can render without guessing.

**page** — state `{sections: [{id, title, body}]}`.
- `edit_section({id, title?, body?})` — `owner` only. Reading is public as
  always; the words are editable live by the owner, including through an agent.

**log** — state `{entries: [{seq, at, look: {mode, accent, radius}}]}`.
- `record({seq, look})` — `public`. Appends `{seq, at: ctx.now, look}` unless
  an entry with that `seq` already exists (dedupe), capped at 200 entries,
  oldest dropped. Returns `{recorded: true|false}`.
- `clear()` — `owner`.

## Who writes the log: the watchers report

Apps cannot call apps in this foundation (deferred by design), so the look app
cannot push to the log server-side. Instead: every open home face already
watches the look app. On each look-state change it calls `log.record({seq,
look})` with the new snapshot. The `seq` dedupe makes this correct under any
number of open tabs: the DO serializes invocations, the first report of a seq
is recorded, the rest are refused as duplicates. Any change is logged exactly
once as long as at least one page is open, no matter which door made it.

## The home face and GET /

One self-contained face, stored as `home` in the registry. It:
- connects to the page app: renders `sections` live;
- connects to the look app: applies `{mode, accent, radius}` as CSS custom
  properties on `:root`, live; offers page controls (mode toggle, accent
  swatches, radius picker) that call the look verbs; reports look changes to
  the log (watcher-report above);
- being same-origin, registers the look app's public verbs as WebMCP tools, so
  a visitor's agent can restyle the site for everyone;
- links to the log's view faces and to `PROTOCOL.md`/the manual.

Router change (small): `GET /` with `text/html` in Accept serves the stored
face named `home` when it exists, else the current built-in manual page.
Agents (no text/html) keep receiving the markdown manual unchanged.

App ids are minted at seed time, so the seed script substitutes them into the
face HTML before registering it (placeholder substitution, the pattern the
ancestor project proved).

## The log views

Two small faces over the log app, registered as `timeline` (the changes as a
scrubbing list: who the site was, when) and `stats` (counts per accent, per
mode). Same state, different views; neither is "the" app.

## Seeding

`scripts/seed-site.sh`: mints the three apps, substitutes their ids into the
faces, registers `home`, `timeline`, `stats`, and prints the ids. Writes the
ids to a gitignored `.site-ids` and refuses to run again while it exists
(re-seeding is deliberate, not accidental).

## Out of scope here

The mint-your-own-app flow (tier 2) and the custom-domain wiring are separate
steps. This spec is only the constellation.
