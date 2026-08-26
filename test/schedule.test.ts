import { describe, it, expect } from "vitest";
import { runDurableObjectAlarm } from "cloudflare:test";
import { nextCronTime } from "../src/schedule";
import { mint, counterCharter } from "./helpers";

describe("nextCronTime", () => {
  it("computes the next daily 06:00 UTC occurrence after a given instant", () => {
    const from = Date.UTC(2026, 0, 1, 5, 0, 0); // 05:00 UTC
    const next = nextCronTime("0 6 * * *", from);
    expect(next).toBe(Date.UTC(2026, 0, 1, 6, 0, 0));
  });

  it("rolls to the next day when already past", () => {
    const from = Date.UTC(2026, 0, 1, 7, 0, 0); // 07:00 UTC
    const next = nextCronTime("0 6 * * *", from);
    expect(next).toBe(Date.UTC(2026, 0, 2, 6, 0, 0));
  });

  it("throws on an invalid expression", () => {
    expect(() => nextCronTime("not a cron", Date.UTC(2026, 0, 1))).toThrow();
  });
});

describe("schedule", () => {
  const owner = { "X-Owner": "1" };
  const guest = { "X-Owner": "0" };

  it("alarm runs the scheduled verb and re-arms", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter, { count: 0 });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(1);
  });

  it("amending away the schedule disarms the alarm", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter);
    await stub.fetch("https://do/charter", { method: "PUT", headers: owner, body: JSON.stringify({ schedule: null }) });
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("alarm invokes an owner-only scheduled verb with no caller present", async () => {
    // `reset` has access: "owner". The alarm fires with nobody logged in, so
    // this proves the alarm bypasses the access check entirely (the platform
    // is the caller), not just that it happens to work for public verbs.
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "reset" };
    const { stub } = await mint(charter, { count: 5 });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(0);
  });

  it("a rollback that restores a scheduled charter re-arms the alarm", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter, { count: 0 });

    // amend away the schedule; confirm it's disarmed (exercises amend's applySchedule call)
    await stub.fetch("https://do/charter", { method: "PUT", headers: owner, body: JSON.stringify({ schedule: null }) });
    expect(await runDurableObjectAlarm(stub)).toBe(false);

    // roll back to version 1 (the original charter, with the schedule) -- this
    // must exercise rollback()'s own applySchedule call, independent of init's.
    const rb = await stub.fetch("https://do/rollback", { method: "POST", headers: owner, body: JSON.stringify({ version: 1 }) });
    expect(rb.status).toBe(200);

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(1);
  });
});
