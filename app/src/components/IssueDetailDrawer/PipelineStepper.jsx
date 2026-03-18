import React from "react";
import { Lightbulb, PlayCircle, Eye, CheckCircle2, GitMerge } from "lucide-react";

// ── Pipeline steps definition ────────────────────────────────────────────────

export const PIPELINE_STEPS = [
  { key: "plan", label: "Plan", icon: Lightbulb, states: ["Planning"] },
  { key: "execute", label: "Execute", icon: PlayCircle, states: ["Planned", "Queued", "Running"] },
  { key: "review", label: "Review", icon: Eye, states: ["Reviewing", "Reviewed"] },
  { key: "done", label: "Approved", icon: CheckCircle2, states: ["Done"] },
  { key: "merge", label: "Merge", icon: GitMerge, states: [] },
];

export function getPipelineIndex(issue) {
  if (issue.state === "Cancelled") return -1;
  if (issue.mergedAt || issue.state === "Done") return 4;
  if (issue.state === "Reviewing" || issue.state === "Reviewed") return 2;
  if (["Running", "Queued", "Planned"].includes(issue.state)) return 1;
  if (issue.state === "Blocked") return issue.tokensByPhase?.reviewer?.totalTokens > 0 ? 2 : 1;
  if (issue.state === "Planning") return 0;
  return 0;
}

export function PipelineStepper({ issue }) {
  const currentIdx = getPipelineIndex(issue);
  const isMerged = !!issue.mergedAt;
  const isCancelled = issue.state === "Cancelled";

  if (isCancelled) return null;

  const currentStep = PIPELINE_STEPS[currentIdx];
  const currentLabel = isMerged ? "Merged" : currentStep?.label;

  return (
    <div className="flex items-center gap-3 py-1.5">
      {currentLabel && (
        <span className={`text-[10px] shrink-0 font-medium ${isMerged || issue.state === "Done" ? "text-success" : "text-primary opacity-70"}`}>
          {currentLabel}
        </span>
      )}
      <div className="flex items-center flex-1 gap-0">
        {PIPELINE_STEPS.map((step, i) => {
          const isDone = i < currentIdx || (i === currentIdx && issue.state === "Done");
          const isMergeStep = step.key === "merge";
          const mergeComplete = isMergeStep && isMerged;
          const isCurrent = (i === currentIdx && issue.state !== "Done") || (isMergeStep && issue.state === "Done" && !isMerged);
          const stepDone = isDone || mergeComplete;

          return (
            <React.Fragment key={step.key}>
              {i > 0 && (
                <div className={`flex-1 h-px transition-colors duration-300 ${stepDone ? "bg-success" : isCurrent ? "bg-primary/30" : "bg-base-300"}`} />
              )}
              <div
                title={step.label}
                className={[
                  "size-2 rounded-full transition-all duration-300 shrink-0",
                  stepDone ? "bg-success" : "",
                  isCurrent ? "bg-primary ring-2 ring-primary/25 scale-[1.4]" : "",
                  !stepDone && !isCurrent ? "bg-base-300" : "",
                ].filter(Boolean).join(" ")}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
