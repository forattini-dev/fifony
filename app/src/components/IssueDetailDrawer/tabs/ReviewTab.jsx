import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Code, FlaskConical, ThumbsUp, RotateCcw, XCircle, AlertTriangle,
  CheckCircle2, GitMerge, Rocket, Paperclip, Loader,
  ExternalLink, ImageIcon, History, Wrench, Zap, Bot,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { Section } from "../shared.jsx";
import { DiffFileItem, DiffViewer } from "./DiffTab.jsx";

export function ReviewTab({ issue, issueId, onStateChange, onRetry }) {
  const qc = useQueryClient();

  // ── Diff state ──────────────────────────────────────────────────────────────
  const [diffData, setDiffData] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [expandedFile, setExpandedFile] = useState(null);

  // ── Merge preview + git status ──────────────────────────────────────────────
  const [mergePreview, setMergePreview] = useState(null);
  const [gitClean, setGitClean] = useState(null); // null = loading, true = clean, false = dirty

  // ── Test Live state ─────────────────────────────────────────────────────────
  const [tested, setTested] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState(null);
  const [testWorkspacePath, setTestWorkspacePath] = useState(issue.testWorkspacePath ?? null);

  // ── Evidence images ─────────────────────────────────────────────────────────
  const [reviewImages, setReviewImages] = useState(issue.images ?? []);
  const [imgUploading, setImgUploading] = useState(false);
  const reviewFileRef = useRef(null);

  // ── Rework feedback ─────────────────────────────────────────────────────────
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkNote, setReworkNote] = useState("");

  // ── Approve & Merge ─────────────────────────────────────────────────────────
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState(null);

  // ── Cancel ──────────────────────────────────────────────────────────────────
  const [cancelBusy, setCancelBusy] = useState(false);

  // ── Derived state ───────────────────────────────────────────────────────────
  const isInReview = issue.state === "Reviewing" || issue.state === "PendingDecision";
  const canDecide = issue.state === "PendingDecision"; // Decision actions only after review completes
  const isApproved = issue.state === "Approved";
  const isMergedState = issue.state === "Merged";
  const isMerged = !!issue.mergedAt || isMergedState;
  const mergeResult = issue.mergeResult;

  // ── Fetch diff ──────────────────────────────────────────────────────────────
  const fetchDiff = useCallback(async () => {
    setDiffLoading(true);
    try {
      const res = await api.get(`/diff/${encodeURIComponent(issueId)}`);
      setDiffData(res);
    } catch {
      setDiffData(null);
    } finally {
      setDiffLoading(false);
    }
  }, [issueId]);

  // ── Fetch merge preview ─────────────────────────────────────────────────────
  const fetchMergePreview = useCallback(async () => {
    try {
      const res = await api.get(`/issues/${encodeURIComponent(issueId)}/merge-preview`);
      setMergePreview(res);
    } catch {
      setMergePreview(null);
    }
  }, [issueId]);

  // ── Reset on issue change ───────────────────────────────────────────────────
  useEffect(() => {
    setTested(!!issue.testApplied);
    setTestWorkspacePath(issue.testWorkspacePath ?? null);
    setDiffData(null);
    setExpandedFile(null);
    setMergePreview(null);
    setGitClean(null);
    setTestError(null);
    setReworkOpen(false);
    setReworkNote("");
    setMergeError(null);
    setReviewImages(issue.images ?? []);
  }, [issueId, issue.testApplied, issue.testWorkspacePath]);

  useEffect(() => { fetchDiff(); }, [fetchDiff]);
  const MERGE_ELIGIBLE_STATES = ["Reviewing", "PendingDecision", "Approved"];
  useEffect(() => { if (MERGE_ELIGIBLE_STATES.includes(issue.state)) fetchMergePreview(); }, [fetchMergePreview, issue.state]);
  useEffect(() => {
    api.get("/git/status")
      .then((s) => setGitClean(s.isClean !== false))
      .catch(() => setGitClean(null));
  }, [issueId]);

  // ── Paste handler for images ────────────────────────────────────────────────
  const uploadReviewImages = useCallback(async (files) => {
    if (!files.length) return;
    setImgUploading(true);
    try {
      const encoded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result.split(",")[1], type: file.type });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })));
      const res = await api.post(`/issues/${encodeURIComponent(issueId)}/images`, { files: encoded });
      if (res.ok && res.paths) setReviewImages((prev) => [...prev, ...res.paths]);
    } catch { /* ignore */ }
    finally {
      setImgUploading(false);
      if (reviewFileRef.current) reviewFileRef.current.value = "";
    }
  }, [issueId]);

  useEffect(() => {
    const handlePaste = (e) => {
      const pastedFiles = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (pastedFiles.length) uploadReviewImages(pastedFiles);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [uploadReviewImages]);

  // ── Diff parsing ────────────────────────────────────────────────────────────
  const files = diffData?.files || [];
  const diff = diffData?.diff || "";
  const diffChunks = {};
  if (diff) {
    for (const chunk of diff.split(/(?=^diff --git )/m)) {
      const m = chunk.match(/^diff --git a\/(.+?) b\//);
      if (m) diffChunks[m[1]] = chunk.split("\n");
    }
  }

  // ── Action handlers ─────────────────────────────────────────────────────────
  const handleTryLive = useCallback(async () => {
    setTestBusy(true);
    setTestError(null);
    try {
      const res = await api.post(`/issues/${encodeURIComponent(issue.id)}/try`);
      setTested(true);
      setTestWorkspacePath(res?.issue?.testWorkspacePath ?? issue.testWorkspacePath ?? null);
      qc.invalidateQueries({ queryKey: ["runtime-state"] });
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }, [issue.id, issue.testWorkspacePath, qc]);

  const handleRevertTry = useCallback(async () => {
    setTestBusy(true);
    setTestError(null);
    try {
      await api.post(`/issues/${encodeURIComponent(issue.id)}/revert-try`);
      setTested(false);
      setTestWorkspacePath(null);
      qc.invalidateQueries({ queryKey: ["runtime-state"] });
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }, [issue.id, qc]);

  const handleApproveAndMerge = useCallback(async () => {
    setMergeBusy(true);
    setMergeError(null);
    try {
      await api.post(`/issues/${encodeURIComponent(issue.id)}/approve-and-merge`);
      qc.invalidateQueries({ queryKey: ["runtime-state"] });
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMergeBusy(false);
    }
  }, [issue.id, qc]);

  const handleApproveOnly = useCallback(async () => {
    onStateChange?.(issue.id, "Approved");
  }, [issue.id, onStateChange]);

  const handleRework = useCallback(async () => {
    onRetry?.(issue.id, reworkNote || undefined);
    setReworkOpen(false);
    setReworkNote("");
  }, [issue.id, reworkNote, onRetry]);

  const handleCancel = useCallback(async () => {
    setCancelBusy(true);
    try {
      await api.post(`/issues/${encodeURIComponent(issue.id)}/cancel`);
      qc.invalidateQueries({ queryKey: ["runtime-state"] });
    } catch { /* ignore */ }
    finally {
      setCancelBusy(false);
    }
  }, [issue.id, qc]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">

      {/* ── Status Banners ─────────────────────────────────────────────────── */}

      {isApproved && !isMerged && (!mergeResult || mergeResult.conflicts === 0) && (
        <div className="alert border border-success/30 bg-success/5 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-success" />
          <span className="font-semibold">Approved — ready to merge</span>
        </div>
      )}

      {isMerged && (
        <div className={`alert border text-sm ${mergeResult?.conflicts > 0 ? "border-warning/30 bg-warning/5" : "border-success/30 bg-success/5"}`}>
          <GitMerge className={`size-4 shrink-0 ${mergeResult?.conflicts > 0 ? "text-warning" : "text-success"}`} />
          <div>
            <span className="font-semibold">Merged</span>
            {mergeResult && (
              <span className="opacity-70"> — {mergeResult.copied} file{mergeResult.copied !== 1 ? "s" : ""} copied{mergeResult.deleted > 0 ? `, ${mergeResult.deleted} deleted` : ""}</span>
            )}
            {mergeResult?.conflicts > 0 && (
              <>
                <p className="text-xs text-warning font-medium mt-0.5">
                  Merge aborted — {mergeResult.conflicts} file{mergeResult.conflicts !== 1 ? "s" : ""} had conflicts.
                </p>
                {mergeResult.conflictFiles?.length > 0 && (
                  <ul className="text-xs text-warning/80 mt-1 ml-4 list-disc space-y-0.5">
                    {mergeResult.conflictFiles.map((f) => (
                      <li key={f} className="font-mono">{f}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {(!mergeResult?.conflicts || mergeResult.conflicts === 0) && (
              <p className="text-xs opacity-50 mt-0.5">The approved branch has been integrated into the current project branch.</p>
            )}
          </div>
        </div>
      )}

      {!isMerged && isApproved && mergeResult?.conflicts > 0 && (
        <div className="alert border border-warning/30 bg-warning/5 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <div className="flex-1">
            <span className="font-semibold">Merge failed due to conflicts</span>
            <p className="text-xs opacity-70 mt-0.5">
              The branch {issue.branchName ? <span className="font-mono">{issue.branchName}</span> : ""} could not be merged — {mergeResult.conflicts} file{mergeResult.conflicts !== 1 ? "s" : ""} diverged.
            </p>
            {mergeResult.conflictFiles?.length > 0 && (
              <ul className="text-xs opacity-60 mt-1 ml-4 list-disc space-y-0.5">
                {mergeResult.conflictFiles.map((f) => (
                  <li key={f} className="font-mono">{f}</li>
                ))}
              </ul>
            )}
            <button
              className="btn btn-xs btn-warning gap-1 mt-2"
              onClick={() => onRetry?.(issue.id)}
            >
              <RotateCcw className="size-3" /> Requeue for Rework
            </button>
          </div>
        </div>
      )}

      {issue.prUrl && (
        <div className="alert border border-primary/30 bg-primary/5 text-sm">
          <ExternalLink className="size-4 shrink-0 text-primary" />
          <div>
            <span className="font-semibold">Pull request created</span>
            <a
              href={issue.prUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-primary hover:underline mt-0.5 font-mono break-all"
            >
              {issue.prUrl}
            </a>
          </div>
        </div>
      )}


      {/* ── Phase 1: Review Changes ────────────────────────────────────────── */}

      <Section title="Review Changes" icon={Code}>
        {diffLoading ? (
          <div className="flex items-center gap-2 text-sm opacity-50 py-4">
            <span className="loading loading-spinner loading-xs" /> Loading changes...
          </div>
        ) : files.length > 0 ? (
          <div className="space-y-3">
            {/* Diff stats bar */}
            <div className="flex items-center gap-3 text-sm">
              <span className="opacity-60">{files.length} file{files.length !== 1 ? "s" : ""} changed</span>
              <span className="text-success font-mono text-xs">+{diffData?.totalAdditions || 0}</span>
              <span className="text-error font-mono text-xs">-{diffData?.totalDeletions || 0}</span>
            </div>

            {/* File list with expandable diffs */}
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
            {expandedFile && diffChunks[expandedFile] && (
              <div>
                <div className="text-xs font-mono opacity-50 mb-1">{expandedFile}</div>
                <DiffViewer lines={diffChunks[expandedFile]} />
              </div>
            )}

            {/* Merge preview */}
            {mergePreview?.willConflict && (
              <div className="alert alert-warning text-xs py-2 gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" />
                <div>
                  <span className="font-semibold">Merge will conflict</span>
                  <span className="opacity-70"> — {mergePreview.conflictFiles.length} file{mergePreview.conflictFiles.length !== 1 ? "s" : ""}</span>
                  {mergePreview.conflictFiles.length > 0 && (
                    <ul className="mt-1 ml-4 list-disc space-y-0.5 font-mono opacity-80">
                      {mergePreview.conflictFiles.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {mergePreview && !mergePreview.willConflict && (
              <div className="alert alert-success text-xs py-2 gap-1.5">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>Merge is clean — no conflicts detected.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm opacity-40 py-4">No changes detected.</div>
        )}

        {/* Git dirty warning */}
        {gitClean === false && (
          <div className="alert alert-warning text-xs py-2 gap-1.5 mt-3">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>Project has uncommitted changes — merge preview and merge will fail until you commit or stash them first.</span>
          </div>
        )}

        {/* AI reviewer output */}
        {issue.lastError && (
          <pre className="text-xs bg-error/10 rounded-box p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto mt-3">
            {issue.lastError}
          </pre>
        )}
        {issue.commandOutputTail && !issue.lastError && (
          <pre className="text-xs bg-base-200 rounded-box p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto mt-3">
            {issue.commandOutputTail}
          </pre>
        )}
      </Section>


      {/* ── Phase 2: Test Live (collapsible) ───────────────────────────────── */}

      {isInReview && (
        <div className="collapse collapse-arrow border border-base-300 rounded-box bg-base-100">
          <input type="checkbox" />
          <div className="collapse-title text-sm font-semibold flex items-center gap-1.5 py-3 min-h-0">
            <FlaskConical className="size-4 opacity-50" />
            Optional: Create isolated test workspace
          </div>
          <div className="collapse-content space-y-4">
            {testError && (
              <div className="alert alert-error text-xs py-2 gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" /> {testError}
              </div>
            )}

            {!tested ? (
              <div className="space-y-3">
                <p className="text-xs opacity-60">
                  Create a separate workspace with the issue branch checked out so you can run and inspect it safely before deciding.
                </p>
                <button
                  className="btn btn-info btn-sm btn-soft gap-1.5 w-full"
                  onClick={handleTryLive}
                  disabled={testBusy}
                  title="Create an isolated test workspace"
                >
                  {testBusy ? <Loader className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                  Create Test Workspace
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="alert alert-info text-xs py-2 gap-1.5">
                  <FlaskConical className="size-3.5 shrink-0" />
                  <div className="space-y-1">
                    <div>Isolated test workspace ready. Run your app from there if you want to verify behavior before deciding.</div>
                    {testWorkspacePath && (
                      <div className="font-mono break-all opacity-80">{testWorkspacePath}</div>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-warning btn-sm btn-soft gap-1.5 w-full"
                  onClick={handleRevertTry}
                  disabled={testBusy}
                >
                  {testBusy ? <Loader className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  Remove Test Workspace
                </button>
              </div>
            )}

            <div className="h-0" /> {/* spacer — evidence section moved outside isInReview */}
          </div>
        </div>
      )}

      {/* ── Evidence (always visible — not gated by review state) ──────────── */}

      <Section title="Evidence" icon={ImageIcon}>
        <input
          ref={reviewFileRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => uploadReviewImages(Array.from(e.target.files ?? []))}
        />
        {reviewImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {reviewImages.map((imgPath, i) => {
              const filename = imgPath.split("/").pop();
              const src = `/api/issues/${encodeURIComponent(issueId)}/images/${encodeURIComponent(filename)}`;
              return (
                <a key={i} href={src} target="_blank" rel="noreferrer" className="block">
                  <img src={src} alt={filename} className="size-20 object-cover rounded-lg border border-base-300 hover:opacity-80 transition-opacity" />
                </a>
              );
            })}
          </div>
        )}
        {reviewImages.length === 0 && (
          <p className="text-xs opacity-40">No screenshots attached. Paste or upload images as evidence.</p>
        )}
        <button
          type="button"
          className="btn btn-xs btn-soft btn-ghost gap-1 mt-2"
          onClick={() => reviewFileRef.current?.click()}
          disabled={imgUploading}
        >
          {imgUploading ? <Loader className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
          Attach Screenshot
        </button>
      </Section>


      {/* ── Phase 3: Decision (only after review completes → PendingDecision) */}

      {canDecide && (
        <Section title="Decision" icon={ThumbsUp}>
          <div className="space-y-4">
            {mergeError && (
              <div className="alert alert-error text-xs py-2 gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" /> {mergeError}
              </div>
            )}

            {/* Approve & Merge */}
            <button
              className="btn btn-success w-full gap-1.5"
              onClick={handleApproveAndMerge}
              disabled={mergeBusy}
            >
              {mergeBusy ? (
                <Loader className="size-4 animate-spin" />
              ) : tested ? (
                <Rocket className="size-4" />
              ) : (
                <GitMerge className="size-4" />
              )}
              {mergeBusy ? "Merging..." : tested ? "Ship It" : "Approve & Merge"}
            </button>

            {/* Approve Only */}
            <button
              className="btn btn-success btn-outline btn-sm w-full gap-1.5"
              onClick={handleApproveOnly}
            >
              <ThumbsUp className="size-3.5" />
              Approve Only
            </button>

            {/* Request Rework */}
            {!reworkOpen ? (
              <button
                className="btn btn-warning btn-outline btn-sm w-full gap-1.5"
                onClick={() => setReworkOpen(true)}
              >
                <RotateCcw className="size-3.5" />
                Request Rework
              </button>
            ) : (
              <div className="border border-warning/30 rounded-box p-3 space-y-3 bg-warning/5">
                <textarea
                  className="textarea textarea-bordered w-full text-sm"
                  rows={3}
                  placeholder="Describe what needs to change (sent to the agent)..."
                  value={reworkNote}
                  onChange={(e) => setReworkNote(e.target.value)}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-ghost btn-sm flex-1"
                    onClick={() => { setReworkOpen(false); setReworkNote(""); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-warning btn-sm flex-1 gap-1.5"
                    onClick={handleRework}
                  >
                    <RotateCcw className="size-3.5" />
                    Send Rework
                  </button>
                </div>
              </div>
            )}

            {/* Cancel Issue */}
            <div className="pt-2 border-t border-base-300">
              <button
                className="btn btn-ghost btn-sm text-error w-full gap-1.5"
                onClick={handleCancel}
                disabled={cancelBusy}
              >
                {cancelBusy ? <Loader className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
                Cancel Issue
              </button>
            </div>
          </div>
        </Section>
      )}
      {/* ── History: previous attempts, plans, merge results ──────────── */}
      <AttemptHistory issue={issue} />
    </div>
  );
}

// ── Attempt History Section ───────────────────────────────────────────────

function AttemptHistory({ issue }) {
  const attempts = issue.previousAttemptSummaries || [];
  const planHistory = issue.planHistory || [];
  const resolution = issue.mergeResult?.conflictResolution;
  const rebase = issue.rebaseResult;
  const hasHistory = attempts.length > 0 || planHistory.length > 0 || resolution || rebase;
  const hasUsage = issue.toolsUsed?.length || issue.skillsUsed?.length || issue.agentsUsed?.length;

  if (!hasHistory && !hasUsage) return null;

  return (
    <Section title="History & Insights" icon={History}>
      <div className="space-y-3">
        {/* Tools/Skills/Agents used across all turns */}
        {hasUsage && (
          <div className="space-y-1.5">
            {issue.toolsUsed?.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center">
                <Wrench className="size-3 opacity-40" />
                <span className="text-[10px] uppercase tracking-wide opacity-40">Tools:</span>
                {issue.toolsUsed.map((t) => (
                  <span key={t} className="badge badge-xs badge-outline font-mono">{t}</span>
                ))}
              </div>
            )}
            {issue.skillsUsed?.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center">
                <Zap className="size-3 opacity-40" />
                <span className="text-[10px] uppercase tracking-wide opacity-40">Skills:</span>
                {issue.skillsUsed.map((s) => (
                  <span key={s} className="badge badge-xs badge-primary font-mono">{s}</span>
                ))}
              </div>
            )}
            {issue.agentsUsed?.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center">
                <Bot className="size-3 opacity-40" />
                <span className="text-[10px] uppercase tracking-wide opacity-40">Agents:</span>
                {issue.agentsUsed.map((a) => (
                  <span key={a} className="badge badge-xs badge-secondary font-mono">{a}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Merge conflict resolution result */}
        {resolution && (
          <div className={`alert text-xs py-2 gap-1.5 ${resolution.resolved ? "alert-success" : "alert-warning"}`}>
            <GitMerge className="size-3.5 shrink-0" />
            <div>
              <div className="font-semibold">
                {resolution.resolved
                  ? `Conflicts auto-resolved by ${resolution.provider}`
                  : `Conflict resolution attempted (${resolution.provider}) — ${resolution.resolvedFiles.length} of ${issue.mergeResult?.conflictFiles?.length || "?"} resolved`}
              </div>
              <div className="opacity-60">
                {Math.round(resolution.durationMs / 1000)}s · {resolution.resolvedAt ? new Date(resolution.resolvedAt).toLocaleTimeString() : ""}
              </div>
            </div>
          </div>
        )}

        {/* Rebase result */}
        {rebase && (
          <div className={`alert text-xs py-2 gap-1.5 ${rebase.success ? "alert-info" : "alert-warning"}`}>
            <GitMerge className="size-3.5 shrink-0" />
            {rebase.success
              ? "Auto-rebase succeeded — branch was up to date before merge."
              : `Auto-rebase failed — ${rebase.conflictFiles.length} conflict(s): ${rebase.conflictFiles.join(", ")}`}
          </div>
        )}

        {/* Previous failed attempts */}
        {attempts.length > 0 && (
          <div>
            <div className="text-xs font-semibold opacity-50 mb-1.5">Previous Attempts ({attempts.length})</div>
            <div className="space-y-1.5">
              {attempts.map((a, i) => (
                <div key={i} className="bg-base-200 rounded-lg p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`badge badge-xs ${a.phase === "review" ? "badge-secondary" : a.phase === "execute" ? "badge-primary" : "badge-error"}`}>
                      {a.phase || "unknown"}
                    </span>
                    <span className="font-mono opacity-50">v{a.planVersion}a{a.executeAttempt}</span>
                    <span className="opacity-40 ml-auto">{new Date(a.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="opacity-70 line-clamp-2">{a.error}</p>
                  {a.insight && (
                    <div className="text-[10px] opacity-50">
                      {a.insight.errorType}: {a.insight.rootCause}
                      {a.insight.suggestion && <span className="block">{a.insight.suggestion}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plan history (previous plan versions) */}
        {planHistory.length > 0 && (
          <div>
            <div className="text-xs font-semibold opacity-50 mb-1.5">Plan History ({planHistory.length} previous)</div>
            <div className="space-y-1">
              {planHistory.map((plan, i) => (
                <div key={i} className="bg-base-200 rounded-lg p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-xs badge-info">v{i + 1}</span>
                    <span className="truncate flex-1 opacity-70">{plan.summary}</span>
                    <span className="opacity-40">{plan.steps?.length || 0} steps</span>
                    <span className="badge badge-xs badge-ghost">{plan.estimatedComplexity}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
