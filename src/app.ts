import { DurableObject } from "cloudflare:workers";

export class App extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    return Response.json({ ok: false, error: "no route" }, { status: 404 });
  }
}
