import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IssueEntry } from "../src/types.ts";

describe("analytics contract", () => {
  it("hydrates top issues with per-phase breakdown", async () => {
    const { hydrate, getAnalytics } = await import("../src/domains/tokens.ts");

    const issue = {
      id: "issue-analytics-1",
      identifier: "#42",
      title: "Hydrated analytics",
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        costUsd: 1.5,
      },
      tokensByPhase: {
        planner: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        executor: { inputTokens: 70, outputTokens: 50, totalTokens: 120 },
        reviewer: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
      },
    } as IssueEntry;

    hydrate([issue]);
    const analytics = getAnalytics();
    const top = analytics.topIssues[0];

    assert.equal(top.identifier, "#42");
    assert.equal(top.totalTokens, 200);
    assert.equal(top.inputTokens, 120);
    assert.equal(top.outputTokens, 80);
    assert.equal(top.costUsd, 1.5);
    assert.equal(top.byPhase?.executor?.totalTokens, 120);
    assert.equal(top.byPhase?.planner?.totalTokens, 30);
    assert.equal(top.byPhase?.reviewer?.totalTokens, 50);
  });

  it("incremental record keeps top issue phase split in sync", async () => {
    const { hydrate, record, getAnalytics } = await import("../src/domains/tokens.ts");

    hydrate([]);
    const issue = {
      id: "issue-analytics-2",
      identifier: "#99",
      title: "Incremental analytics",
    } as IssueEntry;

    record(issue, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.2, model: "gpt-5.4" }, "planner");
    record(issue, { inputTokens: 30, outputTokens: 10, totalTokens: 40, costUsd: 0.4, model: "gpt-5.4" }, "executor");

    const analytics = getAnalytics();
    const top = analytics.topIssues.find((entry) => entry.id === issue.id);

    assert.ok(top, "recorded issue should appear in topIssues");
    assert.equal(top?.totalTokens, 55);
    assert.equal(top?.inputTokens, 40);
    assert.equal(top?.outputTokens, 15);
    assert.equal(top?.costUsd, 0.6000000000000001);
    assert.equal(top?.byPhase?.planner?.totalTokens, 15);
    assert.equal(top?.byPhase?.executor?.totalTokens, 40);
  });
});
