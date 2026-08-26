# Hypernormal

Hypernormal hosts durable faceless apps: pairs of a charter and a state, each
living at one URL, persisting on their own with no page open and no process
running anywhere. The platform holds no intelligence of its own. It stores
state and executes verbs, and every decision arrives from outside, carried by
whoever invokes it. An app has no canonical interface either: interfaces are
derived from its own charter, by anyone, at any time, and none of them is the
app.

## The three words

- **Durable.** An app's address, state, and behavior persist on their own.
  Closing every browser tab in the world changes nothing about it.
- **Headless.** The platform calls no model, holds no model key, and makes no
  decision. It stores state and executes verbs; nothing more.
- **Faceless.** An app has no canonical interface. Faces are derived,
  disposable, and never the app itself. Several can exist at once, and an app
  needs none of them.

See `DEFINITION.md` for the full spec these three words govern.

## Fork and deploy

This is a Cloudflare Worker. It needs one secret and nothing else to run.

```bash
npm install
npx wrangler secret put OWNER_KEY   # paste a key you choose; this is the whole credential
npm run deploy
```

`npm run deploy` builds before deploying: it copies the QuickJS sandbox's WASM
blob into `src/quickjs.wasm` and the face runtime's real source
(`face/runtime.js`) into `src/runtime-source.txt`, then runs `wrangler deploy`.
Both generated files are gitignored. The Worker serves
`src/runtime-source.txt` verbatim at `GET /runtime.js`, so what ships to
browsers is always exactly `face/runtime.js`, copied, not reimplemented.
`npm run dev` and `npm test` run the same build step first.

Once deployed, sign in at `https://<your-worker>.<subdomain>.workers.dev/login`
with the key you set. Then read `GET /`, the manual: the whole contract,
written for an agent that has never seen this installation before and has
only the URL.

## Optional environment

Neither of these is required. Set them as plain vars in `wrangler.jsonc`, or
with `npx wrangler secret put <NAME>`: neither value is sensitive on its own.

- **`OPEN_MINT`.** Set to exactly the string `"true"` to let guests mint apps
  too (rate-limited, still under every budget in `PROTOCOL.md`). Any other
  value, including `"1"`, or leaving it unset, keeps minting closed to
  everyone but the owner.
- **`WEBMCP_OT_TOKEN`.** A Chrome origin-trial token for the WebMCP API. When
  set, the Worker injects it as a `<meta http-equiv="origin-trial">` tag into
  the `<head>` of every face document served at `GET /f/<name>`. When unset, a
  face is served exactly as it was written.

## Rate limiting

`PUBLIC_RL` and `LOGIN_RL` (in `wrangler.jsonc`, under `unsafe.bindings`) are
Cloudflare rate-limiting bindings, and they require a plan that supports them.
If your plan doesn't, that's fine: the binding is simply absent at runtime,
the platform's own limiter check treats "no binding" as "never limited," and
**the deploy still works exactly as described above. The only difference is
that login attempts, guest minting, and general app traffic have no abuse
limit enforced against them.** Worth knowing before opening `OPEN_MINT` or
handing an installation's URL around widely.

## Reference

- `DEFINITION.md`: the governing spec. The vocabulary (app, charter, verb,
  law, face, owner) and what the platform does and refuses to do.
- `PROTOCOL.md`: the wire protocol. Every route, the error form, the budget
  table, the schema subset a charter's `inputSchema` may use, the socket
  protocol, and the mapping onto WebMCP.
- `examples/`: a few complete charter-and-face pairs (`poll`, `pulse`,
  `shared-list`) worth reading before writing your own.
- `scripts/hn.sh`: a small owner-authenticated CLI for talking to your own
  installation from a shell. Run it with no arguments for usage.

## License

MIT. See `LICENSE`.
