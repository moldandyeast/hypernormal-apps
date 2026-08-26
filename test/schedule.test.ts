import { describe, it, expect } from "vitest";
import { runDurableObjectAlarm } from "cloudflare:test";
import { mint, counterCharter } from "./helpers";

describe("schedule", () => {
  it("alarm runs the scheduled verb and re-arms", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter, { count: 0 });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const s = (await (await stub.fetch("https://do/state", { headers: { "X-Owner": "0" } })).json()) as any;
    expect(s.state.count).toBe(1);
  });
  it("amending away the schedule disarms the alarm", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter);
    await stub.fetch("https://do/charter", { method: "PUT", headers: { "X-Owner": "1" }, body: JSON.stringify({ schedule: null }) });
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});
