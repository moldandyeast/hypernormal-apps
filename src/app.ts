import { DurableObject } from "cloudflare:workers";
import { BUDGET, type Charter, type Env } from "./types";
import { checkCharter, byteLength } from "./charter";
import { checkInput } from "./schema";
import { execute, type HostHttp } from "./sandbox";
import { safeFetch } from "./safe-fetch";

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

    return err(404, `No route for ${request.method} ${path} on this app.`);
  }

  private async init(request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const body = (await request.json().catch(() => null)) as { charter?: unknown; state?: unknown } | null;
    if (!body) return err(400, "Body must be JSON: {charter, state?}.");
    const invalid = checkCharter(body.charter);
    if (invalid) return err(400, invalid);
    if (body.state !== undefined && byteLength(body.state) > BUDGET.STATE) return err(400, "state budget exceeded");
    await this.ctx.storage.put("charter", body.charter as Charter);
    await this.ctx.storage.put("state", body.state ?? {});
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
      if (byteLength(out.result) > BUDGET.RESULT) return err(400, "result budget exceeded");
      if (byteLength(out.state) > BUDGET.STATE) return err(400, "state budget exceeded; state is unchanged");
      await this.ctx.storage.put("state", out.state);
      this.broadcastState(out.state);
      return Response.json({ ok: true, result: out.result });
    });
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

  protected broadcastState(_state: unknown): void {
    // Sockets arrive in Task 8; this hook exists so rpc/seed call sites do not change.
  }
}
