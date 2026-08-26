import { Cron } from "croner";

export function nextCronTime(cronExpr: string, fromMs: number): number {
  const next = new Cron(cronExpr, { timezone: "UTC" }).nextRun(new Date(fromMs));
  if (!next) throw new Error("cron_no_next_run");
  return next.getTime();
}
