import { env } from "cloudflare:test";

export function appStub(id?: string) {
  const objectId = id ? env.APP.idFromString(id) : env.APP.newUniqueId();
  return { id: objectId.toString(), stub: env.APP.get(objectId) };
}

export async function mint(charter: unknown, state?: unknown) {
  const { id, stub } = appStub();
  const res = await stub.fetch("https://do/init", {
    method: "POST",
    headers: { "X-Owner": "1" },
    body: JSON.stringify({ charter, state }),
  });
  return { id, stub, res };
}

export const counterCharter = {
  intent: "A counter. State is {count: number}. bump adds one and returns the new count. read returns the count.",
  verbs: {
    bump: { description: "Add one to the count.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count=(ctx.state.count??0)+1; return ctx.state.count;", access: "public" },
    read: { description: "Return the count.", inputSchema: { type: "object", properties: {} }, code: "return ctx.state.count ?? 0;", access: "public" },
    reset: { description: "Set the count to zero.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count = 0; return 0;", access: "owner" },
  },
  law: { visibility: "unlisted", allowedHosts: [] },
};
