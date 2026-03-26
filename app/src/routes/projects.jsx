import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FolderOpen, Plus, Target, CheckCircle2, ChevronRight, X, Trash2 } from "lucide-react";
import { useDashboard } from "../context/DashboardContext.jsx";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

function progressTone(percent) {
  if (percent >= 100) return "progress-success";
  if (percent >= 50) return "progress-primary";
  return "progress-warning";
}

function ProjectsPage() {
  const ctx = useDashboard();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const milestones = useMemo(
    () => [...ctx.milestones].sort((a, b) =>
      (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")
    ),
    [ctx.milestones],
  );

  const handleCreate = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await ctx.createMilestone.mutateAsync({
      name: trimmed,
      description: description.trim() || undefined,
      status: "active",
    });
    setName("");
    setDescription("");
    setFormOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between pt-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
            Milestones
          </h1>
          <p className="text-sm opacity-55 mt-1">Group issues into milestones and track progress automatically.</p>
        </div>
        <button
          className="btn btn-sm btn-primary gap-1.5"
          onClick={() => setFormOpen((v) => !v)}
        >
          {formOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {formOpen ? "Cancel" : "New milestone"}
        </button>
      </div>

      {/* Inline create form (progressive disclosure) */}
      {formOpen && (
        <form onSubmit={handleCreate} className="card bg-base-200 border border-base-300">
          <div className="card-body gap-3">
            <input
              className="input input-bordered w-full"
              placeholder="Milestone name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <textarea
              className="textarea textarea-bordered w-full min-h-20"
              placeholder="Short description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex justify-end">
              <button className="btn btn-primary btn-sm" disabled={ctx.createMilestone.isPending || !name.trim()}>
                {ctx.createMilestone.isPending ? "Creating..." : "Create milestone"}
              </button>
            </div>
          </div>
        </form>
      )}

      {milestones.length === 0 ? (
        <div className="flex-1 grid place-items-center">
          <div className="text-center opacity-55">
            <FolderOpen className="size-10 mx-auto mb-3 opacity-40" />
            <div className="font-semibold">No milestones yet</div>
            <p className="text-sm mt-1">Create one and start attaching issues to it.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {milestones.map((milestone) => (
            <Link
              key={milestone.id}
              to="/issues"
              search={{ milestone: milestone.id }}
              className="group card bg-base-100 border border-base-300 hover:border-primary/40 hover:bg-base-200/60 transition-colors"
            >
              <div className="card-body gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="card-title text-lg">{milestone.name}</h2>
                    {milestone.description && <p className="text-sm opacity-60 mt-1">{milestone.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-40 hover:!opacity-100 text-error transition-opacity"
                      title={milestone.issueCount > 0 ? "Remove all issues first" : "Delete milestone"}
                      disabled={milestone.issueCount > 0}
                      onClick={(e) => {
                        e.preventDefault();
                        ctx.deleteMilestone(milestone.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <ChevronRight className="size-4 opacity-20 group-hover:opacity-60 transition-opacity mt-0.5" />
                  </div>
                </div>

                <progress
                  className={`progress w-full ${progressTone(milestone.progress.progressPercent)}`}
                  value={milestone.progress.progressPercent}
                  max="100"
                />

                <div className="flex flex-wrap gap-3 text-xs opacity-70">
                  <span className="inline-flex items-center gap-1">
                    <Target className="size-3" />
                    {milestone.issueCount} issues
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" />
                    {milestone.progress.completedCount}/{milestone.progress.scopeCount} done
                  </span>
                  <span className="font-mono">{milestone.progress.progressPercent}%</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
