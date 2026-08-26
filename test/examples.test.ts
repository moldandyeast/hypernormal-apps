import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import list from "../examples/shared-list/charter.json";
import poll from "../examples/poll/charter.json";
import pulse from "../examples/pulse/charter.json";

const owner = { Authorization: "Bearer test-owner-key" };

describe.each([
  ["shared-list", list, "add", { text: "milk" }],
  ["poll", poll, "vote", { option: "yes" }],
  ["pulse", pulse, "beat", {}],
])("example %s", (name, charter, verb, input) => {
  it("mints and its first verb runs", async () => {
    const res = await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as any;
    const r = await SELF.fetch(`https://x/a/${id}/rpc/${verb}`, { method: "POST", body: JSON.stringify(input) });
    expect(((await r.json()) as any).ok).toBe(true);
  });
});
