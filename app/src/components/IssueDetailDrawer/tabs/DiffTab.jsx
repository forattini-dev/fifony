import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "../../../api.js";
import { CopyButton } from "../shared.jsx";

// ── File status badge ─────────────────────────────────────────────────────────

const FILE_STATUS_BADGE = {
  added: "badge-success",
  removed: "badge-error",
  modified: "badge-info",
};

// ── DiffFileItem ──────────────────────────────────────────────────────────────

export function DiffFileItem({ file, isOpen, onToggle }) {
  return (
    <div className="border border-base-300 rounded-box overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-base-200 transition-colors"
        onClick={onToggle}
      >
        <span className="text-xs opacity-40 transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "" }}>&#9654;</span>
        <span className={`badge badge-xs ${FILE_STATUS_BADGE[file.status] || "badge-ghost"}`}>{file.status}</span>
        <span className="font-mono text-xs truncate flex-1">{file.path}</span>
        <span className="text-xs text-success">+{file.additions}</span>
        <span className="text-xs text-error">-{file.deletions}</span>
      </button>
    </div>
  );
}

// ── DiffViewer ────────────────────────────────────────────────────────────────

export function DiffViewer({ lines }) {
  if (!lines || lines.length === 0) return null;
  return (
    <pre className="text-xs rounded-box p-3 overflow-x-auto max-h-[55vh] overflow-y-auto leading-relaxed bg-base-200 font-mono">
      {lines.map((line, i) => {
        let cls = "";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-success bg-success/10";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-error bg-error/10";
        else if (line.startsWith("@@")) cls = "text-info opacity-60 text-[10px]";
        else if (line.startsWith("diff ")) cls = "font-bold opacity-70 border-t border-base-300 pt-2 mt-2";
        return <div key={i} className={cls}>{line || "\u00a0"}</div>;
      })}
    </pre>
  );
}

// ── DiffTab ───────────────────────────────────────────────────────────────────

export function DiffTab({ issueId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedFile, setExpandedFile] = useState(null);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/diff/${encodeURIComponent(issueId)}`);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => { setData(null); setError(null); setExpandedFile(null); }, [issueId]);
  useEffect(() => { fetchDiff(); }, [fetchDiff]);

  if (loading) {
    return <div className="flex items-center justify-center gap-2 text-sm opacity-50 py-12"><span className="loading loading-spinner loading-sm" /> Loading changes...</div>;
  }
  if (error) {
    return <div className="text-sm text-error py-4">{error}</div>;
  }
  if (!data) return null;

  const { files = [], diff = "", message, totalAdditions = 0, totalDeletions = 0 } = data;

  if (files.length === 0) {
    return <div className="text-sm opacity-40 text-center py-8">{message || "No changes detected."}</div>;
  }

  // Parse diff into per-file chunks for expanding
  const diffChunks = {};
  if (diff) {
    const chunks = diff.split(/(?=^diff --git )/m);
    for (const chunk of chunks) {
      const m = chunk.match(/^diff --git a\/(.+?) b\//);
      if (m) diffChunks[m[1]] = chunk.split("\n");
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-60">{files.length} file{files.length !== 1 ? "s" : ""} changed</span>
          <span className="text-success font-mono text-xs">+{totalAdditions}</span>
          <span className="text-error font-mono text-xs">-{totalDeletions}</span>
        </div>
        <div className="flex items-center gap-1">
          <CopyButton text={diff} />
          <button className="btn btn-xs btn-ghost gap-1" onClick={fetchDiff}>
            <RotateCcw className="size-3" /> Refresh
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="space-y-1">
        {files.map((file) => (
          <DiffFileItem
            key={file.path}
            file={file}
            isOpen={expandedFile === file.path}
            onToggle={() => setExpandedFile(expandedFile === file.path ? null : file.path)}
          />
        ))}
      </div>

      {/* Expanded file diff */}
      {expandedFile && diffChunks[expandedFile] && (
        <div>
          <div className="text-xs font-mono opacity-50 mb-1">{expandedFile}</div>
          <DiffViewer lines={diffChunks[expandedFile]} />
        </div>
      )}

      {/* Full diff toggle */}
      {!expandedFile && (
        <details className="group">
          <summary className="text-xs opacity-50 cursor-pointer select-none list-none flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90">&#9654;</span>
            Show full diff
          </summary>
          <div className="mt-2">
            <DiffViewer lines={diff.split("\n")} />
          </div>
        </details>
      )}
    </div>
  );
}
