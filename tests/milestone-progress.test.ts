import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveMilestoneProgressSummary } from "../src/domains/milestones.ts";
import { createIssueFromPayload, buildRuntimeState } from "../src/domains/issues.ts";
import { deriveConfig } from "../src/domains/config.ts";

describe("milestone progress summary", () => {
  it("counts approved and merged issues as completed work", () => {
    const summary = deriveMilestoneProgressSummary([
      createIssueFromPayload({ id: "i1", identifier: "#1", title: "A", state: "Approved" }, []),
      createIssueFromPayload({ id: "i2", identifier: "#2", title: "B", state: "Merged" }, []),
      createIssueFromPayload({ id: "i3", identifier: "#3", title: "C", state: "Running" }, []),
    ]);

    assert.equal(summary.scopeCount, 3);
    assert.equal(summary.completedCount, 2);
    assert.equal(summary.progressPercent, 66);
  });

  it("excludes cancelled and archived issues from scope", () => {
    const summary = deriveMilestoneProgressSummary([
      createIssueFromPayload({ id: "i1", identifier: "#1", title: "A", state: "Cancelled" }, []),
      createIssueFromPayload({ id: "i2", identifier: "#2", title: "B", state: "Archived" }, []),
      createIssueFromPayload({ id: "i3", identifier: "#3", title: "C", state: "Queued" }, []),
    ]);

    assert.equal(summary.scopeCount, 1);
    assert.equal(summary.completedCount, 0);
    assert.equal(summary.progressPercent, 0);
  });
});

describe("issue milestone linking", () => {
  it("keeps old issues valid when milestoneId is omitted", () => {
    const issue = createIssueFromPayload({ id: "legacy", identifier: "#1", title: "Legacy issue" }, []);
    assert.equal(issue.milestoneId, undefined);
  });

  it("persists milestoneId when provided", () => {
    const issue = createIssueFromPayload({
      id: "linked",
      identifier: "#2",
      title: "Linked issue",
      milestoneId: "milestone-core",
    }, []);

    assert.equal(issue.milestoneId, "milestone-core");
  });

  it("hydrates milestones with derived counts and progress", () => {
    const state = buildRuntimeState(
      {
        startedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        trackerKind: "filesystem",
        sourceRepoUrl: "/tmp/demo",
        sourceRef: "workspace",
        config: deriveConfig([]),
        milestones: [
          {
            id: "milestone-core",
            slug: "core",
            name: "Core",
            status: "active",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
            progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
            issueCount: 0,
          },
        ],
        issues: [
          createIssueFromPayload({ id: "i1", identifier: "#1", title: "Done", milestoneId: "milestone-core", state: "Merged" }, []),
          createIssueFromPayload({ id: "i2", identifier: "#2", title: "Open", milestoneId: "milestone-core", state: "Running" }, []),
        ],
        events: [],
        metrics: { total: 0, planning: 0, queued: 0, inProgress: 0, blocked: 0, done: 0, merged: 0, cancelled: 0, activeWorkers: 0 },
        notes: [],
      },
      deriveConfig([]),
    );

    assert.equal(state.milestones[0].issueCount, 2);
    assert.equal(state.milestones[0].progress.scopeCount, 2);
    assert.equal(state.milestones[0].progress.completedCount, 1);
    assert.equal(state.milestones[0].progress.progressPercent, 50);
  });
});
