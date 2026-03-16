import React from "react";
import { X, FileText, Tag } from "lucide-react";

export function IssueDetailDrawer({ issue, onClose }) {
  if (!issue) return null;

  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  const paths = Array.isArray(issue.paths) ? issue.paths : [];

  return (
    <div
      className={`fixed inset-0 z-40 transition-opacity ${issue ? "bg-black/35" : "bg-transparent pointer-events-none"}`}
      onClick={onClose}
    >
      <div
        className="fixed top-0 right-0 z-50 h-full w-full md:w-1/2 bg-base-100 shadow-2xl transform transition-transform duration-200 ease-out translate-x-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-300">
          <div className="flex items-center gap-2">
            <FileText className="size-5 opacity-60" />
            <h2 className="text-lg font-bold">Issue details</h2>
          </div>
          <button type="button" className="btn btn-sm btn-ghost btn-circle" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto h-[calc(100%-64px)]">
          <div className="grid gap-2">
            <div className="font-semibold text-sm">{issue.identifier}</div>
            <div className="text-lg font-semibold">{issue.title || "-"}</div>
            <p className="text-sm opacity-70">{issue.description || "No description"}</p>
          </div>

          <div className="grid gap-2 text-sm">
            <p><strong>State:</strong> {issue.state || "-"}</p>
            <p><strong>Priority:</strong> {issue.priority ?? "-"}</p>
            <p><strong>Attempts:</strong> {`${issue.attempts ?? 0}/${issue.maxAttempts ?? 0}`}</p>
            <p><strong>Category:</strong> {issue.capabilityCategory || "default"}</p>
            <p><strong>Provider:</strong> {issue.provider || "-"}</p>
            <p><strong>Updated:</strong> {issue.updatedAt ? new Date(issue.updatedAt).toLocaleString() : "-"}</p>
            <p><strong>Paths:</strong></p>
            <ul className="ml-6 text-sm list-disc">
              {paths.length === 0 ? <li className="opacity-50">No paths</li> : paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          </div>

          <div className="border-t border-base-300 pt-3">
            <div className="font-semibold text-sm mb-2 flex items-center gap-1">
              <Tag className="size-4" />
              Labels
            </div>
            <div className="flex flex-wrap gap-2">
              {labels.length === 0 ? <span className="text-sm opacity-50">No labels</span> : labels.map((label) => (
                <span key={label} className="badge badge-sm badge-outline">{label}</span>
              ))}
            </div>
          </div>

          {issue.lastError && (
            <div className="border-t border-base-300 pt-3">
              <div className="font-semibold text-sm mb-2 text-error">Last Error</div>
              <pre className="text-xs bg-error/10 rounded-box p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">{issue.lastError}</pre>
            </div>
          )}

          {issue.commandOutputTail && !issue.lastError && (
            <div className="border-t border-base-300 pt-3">
              <div className="font-semibold text-sm mb-2">Command Output</div>
              <pre className="text-xs bg-base-200 rounded-box p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">{issue.commandOutputTail}</pre>
            </div>
          )}

          <div className="pt-4 flex items-center justify-end gap-2 border-t border-base-300">
            <button
              type="button"
              className="btn btn-sm btn-soft"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IssueDetailDrawer;
