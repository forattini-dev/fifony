import { getAnalytics as getTokenAnalytics, getHourlySnapshot } from "../token-ledger.ts";
import { getEcDailyEvents } from "../store.ts";

export function registerAnalyticsRoutes(app: any): void {
  app.get("/api/analytics/tokens", async (c: any) => {
    const [tokenData, ecEvents] = await Promise.all([
      Promise.resolve(getTokenAnalytics()),
      getEcDailyEvents(),
    ]);
    // Merge EC daily event counts into the daily token array
    if (ecEvents.length > 0) {
      const eventsByDate = new Map(ecEvents.map((e) => [e.date, e.events]));
      const dateSet = new Set(tokenData.daily.map((d: { date: string }) => d.date));
      const merged = tokenData.daily.map((d: { date: string; events?: number }) => ({
        ...d,
        events: (eventsByDate.get(d.date) || 0) + (d.events || 0),
      }));
      for (const e of ecEvents) {
        if (!dateSet.has(e.date)) {
          merged.push({ date: e.date, inputTokens: 0, outputTokens: 0, totalTokens: 0, events: e.events });
        }
      }
      merged.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
      return c.json({ ok: true, ...tokenData, daily: merged });
    }
    return c.json({ ok: true, ...tokenData });
  });

  app.get("/api/analytics/tokens/weekly", async (c: any) => {
    // Weekly is part of the daily data in the ledger — filter client-side
    return c.json({ ok: true, ...getTokenAnalytics() });
  });

  app.get("/api/analytics/hourly", async (c: any) => {
    const hours = Math.min(parseInt(c.req.query("hours") || "24", 10) || 24, 48);
    return c.json({ ok: true, ...getHourlySnapshot(hours) });
  });
}
