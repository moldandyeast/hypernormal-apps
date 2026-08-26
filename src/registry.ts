import { DurableObject } from "cloudflare:workers";
import { BUDGET, type Env } from "./types";
import { VERB_NAME } from "./charter";

const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, intent TEXT, visibility TEXT, updated INTEGER, seq INTEGER);
      CREATE TABLE IF NOT EXISTS faces (name TEXT PRIMARY KEY, title TEXT, html TEXT, targets TEXT, visibility TEXT, updated INTEGER, seq INTEGER);`);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sql = this.ctx.storage.sql;
    const path = url.pathname;
    const m = request.method;

    if (m === "POST" && path === "/apps/register") {
      const b = (await request.json()) as { id: string; intent: string; visibility: string };
      sql.exec(
        "INSERT INTO apps (id, intent, visibility, updated, seq) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(seq),0)+1 FROM apps)) " +
        "ON CONFLICT(id) DO UPDATE SET intent=excluded.intent, visibility=excluded.visibility, updated=excluded.updated, seq=(SELECT COALESCE(MAX(seq),0)+1 FROM apps)",
        b.id, b.intent, b.visibility, Date.now()
      );
      return Response.json({ ok: true });
    }
    if (m === "POST" && path === "/apps/unregister") {
      const b = (await request.json()) as { id: string };
      sql.exec("DELETE FROM apps WHERE id = ?", b.id);
      return Response.json({ ok: true });
    }
    if (m === "GET" && path === "/apps") {
      const apps = sql.exec("SELECT id, intent, visibility, updated FROM apps ORDER BY seq DESC").toArray();
      return Response.json({ ok: true, apps });
    }
    if (path.startsWith("/faces/")) {
      const name = path.slice("/faces/".length);
      if (!VERB_NAME.test(name)) return err(400, `face name must match ${VERB_NAME}`);
      if (m === "PUT") {
        const b = (await request.json()) as { title: string; html: string; targets: string[]; visibility: string };
        if (typeof b.html !== "string" || new TextEncoder().encode(b.html).length > BUDGET.FACE) return err(400, `face budget exceeded: over ${BUDGET.FACE} bytes`);
        sql.exec(
          "INSERT INTO faces (name, title, html, targets, visibility, updated, seq) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq),0)+1 FROM faces)) " +
          "ON CONFLICT(name) DO UPDATE SET title=excluded.title, html=excluded.html, targets=excluded.targets, visibility=excluded.visibility, updated=excluded.updated, seq=(SELECT COALESCE(MAX(seq),0)+1 FROM faces)",
          name, b.title ?? name, b.html, JSON.stringify(b.targets ?? []), b.visibility ?? "unlisted", Date.now()
        );
        return Response.json({ ok: true });
      }
      if (m === "GET") {
        const row = sql.exec("SELECT name, title, html, targets, visibility, updated FROM faces WHERE name = ?", name).toArray()[0];
        if (!row) return err(404, `No face named "${name}".`);
        return Response.json({ ok: true, face: { ...row, targets: JSON.parse(row.targets as string) } });
      }
      if (m === "DELETE") {
        sql.exec("DELETE FROM faces WHERE name = ?", name);
        return Response.json({ ok: true });
      }
    }
    if (m === "GET" && path === "/faces") {
      const faces = sql.exec("SELECT name, title, targets, visibility, updated FROM faces ORDER BY seq DESC").toArray()
        .map((f) => ({ ...f, targets: JSON.parse(f.targets as string) }));
      return Response.json({ ok: true, faces });
    }
    return err(404, `No route for ${m} ${path} on the registry.`);
  }
}
