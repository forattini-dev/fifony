import React from "react";
import { Ban, Layers, GitMerge, AlertOctagon } from "lucide-react";
import { formatDate, formatDuration } from "../../../utils.js";
import { Section, Field } from "../shared.jsx";

export function OverviewTab({ issue }) {
  const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy : [];
  const contextReports = Object.entries(issue.contextReportsByRole ?? {})
    .filter(([, report]) => report && typeof report === "object")
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="space-y-5">

      {/* Merged reason banner */}
      {issue.mergedReason && (
        <div className="flex items-start gap-2 bg-success/10 border border-success/20 rounded-box px-3 py-2.5">
          <GitMerge className="size-3.5 text-success shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-success/70 mb-0.5">Merged</div>
            <div className="text-xs text-success/90">{issue.mergedReason}</div>
          </div>
        </div>
      )}

      {/* Cancelled reason banner */}
      {issue.cancelledReason && (
        <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-box px-3 py-2.5">
          <AlertOctagon className="size-3.5 text-error shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-error/70 mb-0.5">Cancelled</div>
            <div className="text-xs text-error/90">{issue.cancelledReason}</div>
          </div>
        </div>
      )}

      {/* Details + Timing */}
      <Section title="Details" icon={Layers}>
        <div className="space-y-0.5">
          <Field label="Attempts" value={`${issue.attempts ?? 0} / ${issue.maxAttempts ?? 0}`} />
          {issue.branchName && <Field label="Branch" value={issue.branchName} mono />}
          {issue.baseBranch && <Field label="Base branch" value={issue.baseBranch} mono />}
          {issue.worktreePath && <Field label="Code worktree" value={issue.worktreePath} mono />}
          {issue.url && <Field label="URL" value={issue.url} mono />}
          <Field label="Created" value={formatDate(issue.createdAt)} />
          {issue.startedAt && <Field label="Started" value={formatDate(issue.startedAt)} />}
          {issue.completedAt && <Field label="Completed" value={formatDate(issue.completedAt)} />}
          {issue.nextRetryAt && <Field label="Next retry" value={formatDate(issue.nextRetryAt)} />}
          <Field label="Duration" value={formatDuration(issue.durationMs)} />
          {issue.tokenUsage?.totalTokens > 0 && (
            <Field label="Tokens" value={`${issue.tokenUsage.totalTokens.toLocaleString()}${issue.tokenUsage.costUsd ? ` ($${issue.tokenUsage.costUsd.toFixed(4)})` : ""}`} />
          )}
        </div>
      </Section>

      {(issue.memoryFlushAt || (issue.memoryFlushCount ?? 0) > 0 || contextReports.length > 0) && (
        <Section title="Harness Memory" icon={Layers}>
          <div className="space-y-0.5">
            <Field label="Memory flushes" value={issue.memoryFlushCount ?? 0} />
            {issue.memoryFlushAt && <Field label="Last flush" value={formatDate(issue.memoryFlushAt)} />}
            <Field label="Context reports" value={contextReports.length} />
          </div>

          {contextReports.length > 0 && (
            <div className="mt-3 space-y-2">
              {contextReports.map(([role, report]) => (
                <div key={role} className="rounded-xl border border-base-300 bg-base-200/60 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-55">{role}</div>
                      <div className="mt-1 text-xs opacity-70">
                        {report.selectedHits}/{report.totalHits} context hits selected · limit {report.maxHits}
                      </div>
                    </div>
                    {report.memoryFlush?.flushedAt ? (
                      <div className="text-[11px] opacity-45">{formatDate(report.memoryFlush.flushedAt)}</div>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(report.layers ?? []).map((layer) => (
                      <span key={`${role}-${layer.name}`} className="badge badge-xs badge-ghost gap-1">
                        {layer.name}:{layer.selectedHitCount}/{layer.hitCount}
                      </span>
                    ))}
                  </div>
                  {(report.stages ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {report.stages.map((stage) => (
                        <span key={`${role}-stage-${stage.name}`} className="badge badge-xs badge-outline gap-1">
                          {stage.name}
                          {typeof stage.durationMs === "number" ? `${stage.durationMs}ms` : null}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Dependencies */}
      {blockedBy.length > 0 && (
        <Section title="Dependencies" icon={Ban} badge={blockedBy.length}>
          <div className="space-y-0.5">
            {blockedBy.map((d) => <div key={d} className="font-mono text-xs">{d}</div>)}
          </div>
        </Section>
      )}
    </div>
  );
}
