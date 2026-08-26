import { DurableObject } from "cloudflare:workers";
import { BUDGET, type Charter, type Env } from "./types";
import { checkCharter, byteLength, applyAmendment } from "./charter";
import { checkInput } from "./schema";
import { execute, type HostHttp } from "./sandbox";
import { safeFetch } from "./safe-fetch";
import { nextCronTime } from "./schedule";

const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export class App extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();

  private runSerial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const owner = request.headers.get("X-Owner") === "1";
    const path = url.pathname;

    if (request.method === "POST" && path === "/init") return this.init(request, owner);

    const charter = await this.ctx.storage.get<Charter>("charter");
    if (!charter) return err(404, "No app lives at this URL.");

    if (request.method === "GET" && path === "/charter") return Response.json({ ok: true, charter });
    if (request.method === "GET" && path === "/state") return Response.json({ ok: true, state: await this.readState() });
    if (request.method === "PUT" && path === "/state") return this.seed(request, owner);
    if (request.method === "POST" && path.startsWith("/rpc/")) return this.rpc(charter, path.slice(5), request, owner);
    if (request.method === "PUT" && path === "/charter") return this.amend(charter, request, owner);
    if (request.method === "GET" && path === "/history") return this.history();
    if (request.method === "POST" && path === "/rollback") return this.rollback(charter, request, owner);
    if (request.method === "GET" && path === "/export") return Response.json({ ok: true, export: { charter, state: await this.readState() } });
    if (request.method === "POST" && path === "/retire") return this.retire(owner);

    if (path === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return err(426, "Expected a WebSocket upgrade.");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "state", state: await this.readState() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return err(404, `No route for ${request.method} ${path} on this app.`);
  }

  private async init(request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const existing = await this.ctx.storage.get<Charter>("charter");
    if (existing) return err(400, "This app already exists; init cannot be called twice.");
    const body = (await request.json().catch(() => null)) as { charter?: unknown; state?: unknown } | null;
    if (!body) return err(400, "Body must be JSON: {charter, state?}.");
    const invalid = checkCharter(body.charter);
    if (invalid) return err(400, invalid);
    if (body.state !== undefined && byteLength(body.state) > BUDGET.STATE) return err(400, "state budget exceeded");
    await this.ctx.storage.put("charter", body.charter as Charter);
    await this.ctx.storage.put("state", body.state ?? {});
    await this.applySchedule(body.charter as Charter);
    return Response.json({ ok: true }, { status: 201 });
  }

  private async seed(request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const state = await request.json().catch(() => undefined);
    if (state === undefined) return err(400, "Body must be JSON state.");
    if (byteLength(state) > BUDGET.STATE) return err(400, "state budget exceeded");
    return this.runSerial(async () => {
      await this.ctx.storage.put("state", state);
      this.broadcastState(state);
      return Response.json({ ok: true });
    });
  }

  private async rpc(charter: Charter, name: string, request: Request, owner: boolean): Promise<Response> {
    const verb = charter.verbs[name];
    if (!verb) return err(404, `No verb "${name}". Available: ${Object.keys(charter.verbs).join(", ")}`);
    if (verb.access === "owner" && !owner) return err(404, `No verb "${name}".`);
    const input = (await request.json().catch(() => ({}))) as unknown;
    if (byteLength(input) > BUDGET.INPUT) return err(400, `input budget exceeded: over ${BUDGET.INPUT} bytes`);
    const invalid = checkInput(verb.inputSchema, input);
    if (invalid) return err(400, invalid);

    return this.runSerial(async () => {
      const state = await this.readState();
      const hostHttp = charter.law.allowedHosts.length > 0 ? this.makeHostHttp(charter.law.allowedHosts) : undefined;
      const out = await execute(verb.code, state, input, { hostHttp });
      if (!out.ok) return err(400, `${out.error} (verb "${name}"). Fix the code and amend the charter to heal the app.`);
      if (out.state === undefined)
        return err(400, `verb "${name}" left state undefined; a verb must always leave ctx.state as an object`);
      if (byteLength(out.result) > BUDGET.RESULT) return err(400, "result budget exceeded");
      if (byteLength(out.state) > BUDGET.STATE) return err(400, "state budget exceeded; state is unchanged");
      await this.ctx.storage.put("state", out.state);
      this.broadcastState(out.state);
      return Response.json({ ok: true, result: out.result });
    });
  }

  private async amend(current: Charter, request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const patch = await request.json().catch(() => null);
    if (patch === null) return err(400, "Body must be a JSON amendment: {intent?, verbs?, law?, schedule?}.");
    const out = applyAmendment(current, patch);
    if ("error" in out) return err(400, out.error);
    return this.runSerial(async () => {
      await this.pushHistory(current);
      await this.ctx.storage.put("charter", out.charter);
      this.broadcastCharter(out.charter);
      await this.applySchedule(out.charter);
      return Response.json({ ok: true, verbs: Object.keys(out.charter.verbs) });
    });
  }

  private async history(): Promise<Response> {
    const history = (await this.ctx.storage.get<{ version: number; at: number; charter: Charter }[]>("history")) ?? [];
    return Response.json({ ok: true, history });
  }

  private async rollback(current: Charter, request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const body = (await request.json().catch(() => ({}))) as { version?: number };
    const history = (await this.ctx.storage.get<{ version: number; at: number; charter: Charter }[]>("history")) ?? [];
    const entry = history.find((h) => h.version === body.version);
    if (!entry) return err(404, `No history version ${body.version ?? "(none given)"}. Versions: ${history.map((h) => h.version).join(", ") || "none"}.`);
    return this.runSerial(async () => {
      await this.pushHistory(current);
      await this.ctx.storage.put("charter", entry.charter);
      this.broadcastCharter(entry.charter);
      await this.applySchedule(entry.charter);
      return Response.json({ ok: true, restored: entry.version, verbs: Object.keys(entry.charter.verbs) });
    });
  }

  private async retire(owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    return this.runSerial(async () => {
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    });
  }

  private async pushHistory(charter: Charter): Promise<void> {
    const history = (await this.ctx.storage.get<{ version: number; at: number; charter: Charter }[]>("history")) ?? [];
    const seq = ((await this.ctx.storage.get<number>("historySeq")) ?? 0) + 1;
    history.push({ version: seq, at: Date.now(), charter });
    while (history.length > BUDGET.HISTORY) history.shift();
    await this.ctx.storage.put("historySeq", seq);
    await this.ctx.storage.put("history", history);
  }

  private async applySchedule(charter: Charter): Promise<void> {
    if (charter.schedule) {
      await this.ctx.storage.setAlarm(nextCronTime(charter.schedule.cron, Date.now()));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm(): Promise<void> {
    const charter = await this.ctx.storage.get<Charter>("charter");
    if (!charter?.schedule) return;
    const verb = charter.verbs[charter.schedule.verb];
    if (verb) {
      await this.runSerial(async () => {
        const state = await this.readState();
        const hostHttp = charter.law.allowedHosts.length > 0 ? this.makeHostHttp(charter.law.allowedHosts) : undefined;
        const out = await execute(verb.code, state, { scheduled: true }, { hostHttp });
        if (out.ok && byteLength(out.state) <= BUDGET.STATE) {
          await this.ctx.storage.put("state", out.state);
          this.broadcastState(out.state);
        }
      });
    }
    await this.applySchedule(charter);
  }

  protected broadcastCharter(charter: Charter): void {
    this.broadcast(JSON.stringify({ type: "charter", charter }));
  }

  private makeHostHttp(allowedHosts: string[]): HostHttp {
    const call = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      try {
        const res = await safeFetch(url, init, { allowedHosts });
        return { status: res.status, body: res.body };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
    return {
      get: (url, headers) => call(url, { method: "GET", headers }),
      post: (url, body, headers) =>
        call(url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    };
  }

  private readState(): Promise<unknown> {
    return this.ctx.storage.get("state").then((s) => s ?? {});
  }

  protected broadcastState(state: unknown): void {
    this.broadcast(JSON.stringify({ type: "state", state }));
  }

  private broadcast(payload: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* a closing socket is not our problem */ }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    if (message === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
    if (new TextEncoder().encode(message).length > BUDGET.SIGNAL) return;
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { return; }
    if (typeof parsed !== "object" || parsed === null || (parsed as { type?: string }).type !== "presence") return;
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) { try { other.send(message); } catch { /* ignore */ } }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }
}
