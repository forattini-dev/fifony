import { FolderRoot, PencilLine, Sparkles, AlertTriangle } from "lucide-react";
import { buildQueueTitle, normalizeProjectName } from "../../../project-meta.js";

function ProjectStep({
  projectName,
  setProjectName,
  detectedProjectName,
  projectSource,
  workspacePath,
}) {
  const normalizedProjectName = normalizeProjectName(projectName);
  const effectiveSource = normalizedProjectName
    ? projectSource === "saved" || projectSource === "detected"
      ? projectSource
      : "manual"
    : detectedProjectName
      ? "detected"
      : "missing";
  const queueTitle = buildQueueTitle(normalizedProjectName || detectedProjectName);

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center space-y-3">
        <div className="inline-flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
          <FolderRoot className="size-7" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Name this execution queue</h2>
          <p className="text-base-content/60 max-w-xl mx-auto">
            fifony uses your project name to label the queue. Confirm the suggestion below or adjust it before continuing.
          </p>
        </div>
      </div>

      <div className="card bg-base-200/70 border border-base-300/70 shadow-sm">
        <div className="card-body gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Project name</div>
              <div className="text-xs text-base-content/50">This becomes the default queue title for future runs.</div>
            </div>
            {effectiveSource === "saved" && (
              <span className="badge badge-primary badge-soft gap-1.5">
                <Sparkles className="size-3" />
                Saved configuration
              </span>
            )}
            {effectiveSource === "detected" && (
              <span className="badge badge-secondary badge-soft gap-1.5">
                <Sparkles className="size-3" />
                Detected automatically
              </span>
            )}
            {effectiveSource === "manual" && (
              <span className="badge badge-accent badge-soft gap-1.5">
                <PencilLine className="size-3" />
                Edited manually
              </span>
            )}
            {effectiveSource === "missing" && (
              <span className="badge badge-warning badge-soft gap-1.5">
                <AlertTriangle className="size-3" />
                Manual entry required
              </span>
            )}
          </div>

          <label className="form-control w-full gap-2">
            <span className="label-text text-sm font-medium">Project</span>
            <input
              type="text"
              className="input input-bordered w-full text-base"
              placeholder={detectedProjectName || "Enter your project name"}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onBlur={(event) => {
                const nextValue = normalizeProjectName(event.target.value);
                if (nextValue !== projectName) {
                  setProjectName(nextValue);
                }
              }}
            />
          </label>

          {workspacePath && (
            <div className="text-xs text-base-content/50 break-all">
              Workspace: {workspacePath}
            </div>
          )}

          {!detectedProjectName && !normalizedProjectName && (
            <div className="alert alert-warning text-sm">
              <AlertTriangle className="size-4 shrink-0" />
              <span>We could not detect a project name from the current directory. Enter one to continue.</span>
            </div>
          )}

          <div className="rounded-2xl border border-base-300/70 bg-base-100 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.2em] text-base-content/40">Queue title preview</div>
            <div className="mt-2 text-lg font-semibold tracking-tight break-words">
              {queueTitle}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectStep;
