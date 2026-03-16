import { useState, useEffect, useRef } from "react";
import { X, FileText, Loader2, WandSparkles } from "lucide-react";
import { api } from "../api";

function normalizeCsv(str) {
  return typeof str === "string" ? str.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

const EMPTY = { title: "", description: "", priority: "1", maxAttempts: "3", labels: "", paths: "" };

export function CreateIssueDrawer({ open, onClose, onSubmit, isLoading, onToast }) {
  const [form, setForm] = useState(EMPTY);
  const titleRef = useRef(null);
  const [enhanceState, setEnhanceState] = useState({ title: false, description: false });
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: parseInt(form.priority, 10) || 1,
      maxAttempts: parseInt(form.maxAttempts, 10) || 3,
      labels: normalizeCsv(form.labels),
      paths: normalizeCsv(form.paths),
    });
  };

  const handleEnhance = async (field) => {
    if (field !== "title" && field !== "description") return;

    setEnhanceState((prev) => ({ ...prev, [field]: true }));
    try {
      const response = await api.post("/issues/enhance", {
        field,
        title: form.title,
        description: form.description,
      });
      if (typeof response?.value !== "string" || !response.value.trim()) {
        throw new Error("No enhanced value was returned.");
      }
      setForm((prev) => ({ ...prev, [field]: response.value }));
      onToast?.(`Enhanced ${field} with ${response.provider || "provider"}`);
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "Could not enhance text.");
    } finally {
      setEnhanceState((prev) => ({ ...prev, [field]: false }));
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full z-50 bg-base-100 shadow-2xl transition-transform duration-300 ease-out
          w-full md:w-1/2 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-base-300">
            <div className="flex items-center gap-2">
              <FileText className="size-5 opacity-60" />
              <h2 className="text-lg font-bold">New Issue</h2>
            </div>
            <button type="button" className="btn btn-sm btn-ghost btn-circle" onClick={onClose}>
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            <div className="form-control">
              <label className="label justify-between gap-2">
                <span className="label-text font-medium">Title</span>
                <button
                  type="button"
                  className="btn btn-xs btn-soft btn-primary gap-1"
                  onClick={() => handleEnhance("title")}
                  disabled={enhanceState.title || isLoading}
                >
                  {enhanceState.title ? <Loader2 className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
                  Enhance
                </button>
              </label>
              <input
                ref={titleRef}
                className="input input-bordered w-full"
                placeholder="What needs to be done?"
                value={form.title}
                onChange={set("title")}
                required
              />
            </div>

            <div className="form-control">
              <label className="label justify-between gap-2">
                <span className="label-text font-medium">Description</span>
                <button
                  type="button"
                  className="btn btn-xs btn-soft btn-primary gap-1"
                  onClick={() => handleEnhance("description")}
                  disabled={enhanceState.description || isLoading}
                >
                  {enhanceState.description ? <Loader2 className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
                  Enhance
                </button>
              </label>
              <textarea
                className="textarea textarea-bordered w-full min-h-24"
                placeholder="Details, context, acceptance criteria..."
                value={form.description}
                onChange={set("description")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">Priority</span></label>
                <input
                  className="input input-bordered w-full"
                  type="number"
                  min={1}
                  max={10}
                  value={form.priority}
                  onChange={set("priority")}
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">Max Attempts</span></label>
                <input
                  className="input input-bordered w-full"
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxAttempts}
                  onChange={set("maxAttempts")}
                />
              </div>
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text font-medium">Labels</span></label>
              <input
                className="input input-bordered w-full"
                placeholder="bug, frontend, urgent"
                value={form.labels}
                onChange={set("labels")}
              />
              <label className="label"><span className="label-text-alt opacity-50">Comma-separated</span></label>
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text font-medium">Paths</span></label>
              <input
                className="input input-bordered w-full"
                placeholder="src/foo.ts, src/bar.ts"
                value={form.paths}
                onChange={set("paths")}
              />
              <label className="label"><span className="label-text-alt opacity-50">Comma-separated file paths</span></label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-base-300">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary gap-1.5" disabled={isLoading || !form.title.trim()}>
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {isLoading ? "Creating..." : "Create Issue"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default CreateIssueDrawer;
