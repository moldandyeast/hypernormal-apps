import type { Env } from "./types";
export { App } from "./app";
export { Registry } from "./registry";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "no route" }, { status: 404 });
  },
};
