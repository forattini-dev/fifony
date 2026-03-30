import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Send,
  Loader,
  AlertTriangle,
  Menu,
  X,
  MessageSquare,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useChat } from "../hooks/useChat.js";
import { ChatActionCard } from "../components/ChatActionCard.jsx";
import { useDashboard } from "../context/DashboardContext.jsx";
import { api } from "../api.js";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

// ── Constants ───────────────────────────────────────────────────────────────

const COLUMNS = [
  { label: "Planning", states: ["Planning"] },
  { label: "Needs Approval", states: ["PendingApproval"] },
  { label: "In Progress", states: ["Queued", "Running", "Reviewing"] },
  { label: "Blocked", states: ["Blocked"] },
  { label: "Review", states: ["PendingDecision"] },
  { label: "Done", states: ["Approved", "Merged", "Cancelled"] },
];

const STATE_DOT = {
  Planning: "bg-info",
  Queued: "bg-info",
  Running: "bg-primary animate-pulse",
  Reviewing: "bg-secondary animate-pulse",
  PendingApproval: "bg-warning",
  PendingDecision: "bg-warning",
  Blocked: "bg-error",
  Merged: "bg-success",
  Approved: "bg-success",
  Cancelled: "bg-neutral",
};

const STATE_BADGE = {
  Planning: "badge-info",
  PendingApproval: "badge-warning",
  Queued: "badge-info",
  Running: "badge-primary",
  Reviewing: "badge-secondary",
  PendingDecision: "badge-success",
  Blocked: "badge-error",
  Approved: "badge-success",
  Merged: "badge-success",
  Cancelled: "badge-neutral",
};

const GLOBAL_SUGGESTIONS = [
  "Create an issue",
  "What's the project status?",
  "Check services",
];

const ISSUE_SUGGESTIONS = [
  "Explain the plan",
  "What's blocking this?",
  "Retry execution",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

// ── MessageBubble ───────────────────────────────────────────────────────────

function MessageBubble({ role, content, timestamp, actions, sessionId }) {
  const isUser = role === "user";

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-1`}>
      <div
        className={`max-w-[80%] text-sm leading-relaxed px-3 py-2 rounded-lg ${
          isUser ? "bg-base-300 text-base-content" : "text-base-content"
        }`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {content}
      </div>
      {!isUser && Array.isArray(actions) && actions.length > 0 && (
        <div className="flex flex-col gap-2 mt-1 max-w-[80%]">
          {actions.map((action, i) => (
            <ChatActionCard key={i} action={action} sessionId={sessionId} />
          ))}
        </div>
      )}
      {timestamp && (
        <span className="text-[10px] opacity-25 px-1 select-none">
          {relativeTime(timestamp)}
        </span>
      )}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onSuggestion, selectedIssue }) {
  const suggestions = selectedIssue ? ISSUE_SUGGESTIONS : GLOBAL_SUGGESTIONS;
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 opacity-60">
      <MessageSquare className="size-10 opacity-30" />
      <div className="text-sm font-medium">
        {selectedIssue
          ? `Discussing ${selectedIssue.identifier}: ${selectedIssue.title}`
          : "Start a conversation"}
      </div>
      <div className="flex flex-wrap gap-2 justify-center max-w-md">
        {suggestions.map((s) => (
          <button
            key={s}
            className="btn btn-xs btn-outline btn-ghost"
            onClick={() => onSuggestion(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <Loader className="size-3.5 animate-spin opacity-40" />
      <span className="text-xs opacity-35">Thinking...</span>
    </div>
  );
}

// ── Inline error ────────────────────────────────────────────────────────────

function InlineError({ error, onRetry }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-lg text-sm">
      <AlertTriangle className="size-3.5 text-error shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="text-error/80 text-xs">{error}</span>
      </div>
      {onRetry && (
        <button className="btn btn-ghost btn-xs text-error shrink-0" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// ── Context banner ──────────────────────────────────────────────────────────

function ContextBanner({ issue, onDeselect }) {
  if (!issue) return null;
  const badgeClass = STATE_BADGE[issue.state] || "badge-ghost";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-base-300 bg-base-200/50 shrink-0">
      <span className="text-xs font-medium truncate flex-1 min-w-0">
        Discussing{" "}
        <span className="font-mono font-semibold">{issue.identifier}</span>
        <span className="opacity-60 ml-1">{issue.title}</span>
      </span>
      <span className={`badge badge-xs ${badgeClass}`}>{issue.state}</span>
      <button
        className="btn btn-ghost btn-xs btn-square shrink-0"
        onClick={onDeselect}
        aria-label="Deselect issue"
        title="Clear context"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

// ── Issue sidebar item ──────────────────────────────────────────────────────

function IssueItem({ issue, isSelected, onToggle }) {
  const dotClass = STATE_DOT[issue.state] || "bg-base-content/20";
  return (
    <button
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-xs transition-colors ${
        isSelected
          ? "bg-primary/10 ring-1 ring-primary/30 text-base-content"
          : "text-base-content/70 hover:bg-base-200"
      }`}
      onClick={() => onToggle(issue)}
      title={`${issue.identifier}: ${issue.title}`}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span className="font-mono opacity-50 shrink-0">{issue.identifier}</span>
      <span className="truncate flex-1">{issue.title}</span>
    </button>
  );
}

// ── Issue sidebar group ─────────────────────────────────────────────────────

function IssueGroup({ label, issues, selectedIssueId, onToggle, defaultCollapsed }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="space-y-0.5">
      <button
        className="flex items-center gap-1 px-2 py-0.5 w-full text-left text-[10px] font-semibold uppercase tracking-wider opacity-40 hover:opacity-60 transition-opacity"
        onClick={() => setCollapsed((c) => !c)}
      >
        <Chevron className="size-2.5" />
        <span>{label}</span>
        <span className="ml-auto font-mono">{issues.length}</span>
      </button>
      {!collapsed &&
        issues.map((issue) => (
          <IssueItem
            key={issue.id}
            issue={issue}
            isSelected={issue.id === selectedIssueId}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

// ── Sidebar content (shared between desktop and mobile) ─────────────────────

function SidebarContent({ issues, selectedIssueId, onToggle, search, onSearchChange }) {
  const grouped = useMemo(() => {
    const lower = search.toLowerCase();
    const filtered = lower
      ? issues.filter(
          (i) =>
            `${i.identifier} ${i.title}`.toLowerCase().includes(lower),
        )
      : issues;

    return COLUMNS.map((col) => ({
      ...col,
      issues: filtered.filter((i) => col.states.includes(i.state)),
    })).filter((g) => g.issues.length > 0);
  }, [issues, search]);

  return (
    <>
      {/* Search */}
      <div className="px-2 py-2 border-b border-base-300 shrink-0">
        <div className="relative">
          <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 opacity-30" />
          <input
            className="input input-xs input-bordered w-full pl-6 text-xs"
            placeholder="Filter issues..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle size-4"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              <X className="size-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Issue groups */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1.5 py-1.5 space-y-2">
        {grouped.length === 0 ? (
          <div className="text-xs opacity-30 text-center py-8">
            {search ? "No matching issues" : "No issues yet"}
          </div>
        ) : (
          grouped.map((g) => (
            <IssueGroup
              key={g.label}
              label={g.label}
              issues={g.issues}
              selectedIssueId={selectedIssueId}
              onToggle={onToggle}
              defaultCollapsed={g.label === "Done"}
            />
          ))
        )}
      </div>
    </>
  );
}

// ── ChatPage ────────────────────────────────────────────────────────────────

function ChatPage() {
  const chat = useChat();
  const { issues } = useDashboard();
  const qc = useQueryClient();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [isSendingWithIssue, setIsSendingWithIssue] = useState(false);
  const [sendError, setSendError] = useState(null);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const prevMessagesLenRef = useRef(0);

  // ── Derived ────────────────────────────────────────────────────────────
  const selectedIssue = useMemo(
    () => (selectedIssueId ? issues.find((i) => i.id === selectedIssueId) ?? null : null),
    [selectedIssueId, issues],
  );

  // Effective sending / error state (merge useChat states with local issue-send states)
  const isSending = chat.isSending || isSendingWithIssue;
  const error = chat.error || sendError;

  // ── Auto-scroll on new messages ────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current && chat.messages.length !== prevMessagesLenRef.current) {
      prevMessagesLenRef.current = chat.messages.length;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages.length]);

  useEffect(() => {
    if (scrollRef.current && isSending) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isSending]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [chat.currentSessionId]);

  // ── Issue toggle ───────────────────────────────────────────────────────
  const handleToggleIssue = useCallback(
    (issue) => {
      if (selectedIssueId === issue.id) {
        // Deselect
        setSelectedIssueId(null);
      } else {
        setSelectedIssueId(issue.id);
      }
      // Reset chat on context switch
      chat.selectSession(null);
      setSendError(null);
    },
    [selectedIssueId, chat],
  );

  const handleDeselectIssue = useCallback(() => {
    setSelectedIssueId(null);
    chat.selectSession(null);
    setSendError(null);
  }, [chat]);

  // ── Send message ───────────────────────────────────────────────────────
  // When an issue is selected, we bypass useChat.sendMessage to inject issueId.
  // For global mode, we use the standard hook.
  const handleSendText = useCallback(
    async (text) => {
      if (!text?.trim() || isSending) return;
      const trimmed = text.trim();

      if (!selectedIssueId) {
        // Global mode — use hook as-is
        chat.sendMessage(trimmed);
        return;
      }

      // Issue mode — direct API call with issueId
      setIsSendingWithIssue(true);
      setSendError(null);
      try {
        const res = await api.post("/chat", {
          sessionId: chat.currentSessionId || undefined,
          message: trimmed,
          issueId: selectedIssueId,
        });
        // If a new session was created, switch to it
        if (res.sessionId && res.sessionId !== chat.currentSessionId) {
          chat.selectSession(res.sessionId);
        }
        // Invalidate queries to pick up the new message
        qc.invalidateQueries({ queryKey: ["chat-sessions"] });
        if (res.sessionId) {
          qc.invalidateQueries({ queryKey: ["chat-session", res.sessionId] });
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSendingWithIssue(false);
      }
    },
    [isSending, selectedIssueId, chat, qc],
  );

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    handleSendText(text);
  }, [input, handleSendText]);

  const handleSuggestion = useCallback(
    (text) => {
      if (isSending) return;
      handleSendText(text);
    },
    [isSending, handleSendText],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        textareaRef.current?.blur();
      }
    },
    [handleSend],
  );

  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleRetry = useCallback(() => {
    const turns = chat.messages;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "user") {
        chat.clearError();
        setSendError(null);
        handleSendText(turns[i].content);
        return;
      }
    }
  }, [chat, handleSendText]);

  // ── Timestamps refresh ─────────────────────────────────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    if (chat.messages.length === 0 && issues.length === 0) return;
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, [chat.messages.length, issues.length]);

  // ── Provider info from last response ───────────────────────────────────
  const provider = chat.lastResponse?.provider ?? null;

  // ── Normalize messages ─────────────────────────────────────────────────
  const normalizedMessages = useMemo(() => {
    return chat.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp || m.createdAt || m.updatedAt,
      actions: m.actions,
    }));
  }, [chat.messages]);

  const hasMessages = normalizedMessages.length > 0;

  return (
    <div className="flex-1 flex min-h-0">
      {/* ── Sidebar (desktop) ──────────────────────────────────────────── */}
      <aside
        className={`${
          sidebarOpen ? "w-[260px]" : "w-0"
        } hidden md:flex flex-col border-r border-base-300 bg-base-100 shrink-0 transition-all duration-200 overflow-hidden`}
      >
        <SidebarContent
          issues={issues}
          selectedIssueId={selectedIssueId}
          onToggle={handleToggleIssue}
          search={search}
          onSearchChange={setSearch}
        />
      </aside>

      {/* ── Sidebar (mobile overlay) ───────────────────────────────────── */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-64 flex flex-col bg-base-100 shadow-xl z-10">
            <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-40">
                Issues
              </span>
              <button
                className="btn btn-ghost btn-xs btn-square"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close sidebar"
              >
                <X className="size-4" />
              </button>
            </div>
            <SidebarContent
              issues={issues}
              selectedIssueId={selectedIssueId}
              onToggle={(issue) => {
                handleToggleIssue(issue);
                setSidebarOpen(false);
              }}
              search={search}
              onSearchChange={setSearch}
            />
          </aside>
        </div>
      )}

      {/* ── Chat area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-base-300 shrink-0 bg-base-100">
          <button
            className="btn btn-ghost btn-xs btn-square md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="size-4" />
          </button>
          <button
            className="btn btn-ghost btn-xs btn-square hidden md:flex"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <Menu className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate">Chat</span>
          </div>
          {provider && (
            <span className="text-[10px] font-mono opacity-30 shrink-0">
              via {provider}
            </span>
          )}
        </div>

        {/* Context banner */}
        <ContextBanner issue={selectedIssue} onDeselect={handleDeselectIssue} />

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3"
        >
          {!hasMessages && !isSending ? (
            <EmptyState onSuggestion={handleSuggestion} selectedIssue={selectedIssue} />
          ) : hasMessages ? (
            <>
              {normalizedMessages.map((msg, i) => (
                <MessageBubble
                  key={`${chat.currentSessionId}-${i}`}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  actions={msg.actions}
                  sessionId={chat.currentSessionId}
                />
              ))}
              {isSending && <TypingIndicator />}
              {error && <InlineError error={error} onRetry={handleRetry} />}
            </>
          ) : chat.isSessionLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader className="size-5 animate-spin opacity-30" />
            </div>
          ) : (
            <EmptyState onSuggestion={handleSuggestion} selectedIssue={selectedIssue} />
          )}
        </div>

        {/* Input bar */}
        <div className="px-4 py-3 border-t border-base-300 shrink-0 bg-base-100">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="textarea textarea-bordered flex-1 text-sm resize-none leading-snug min-h-[36px]"
              rows={1}
              placeholder={
                selectedIssue
                  ? `Ask about ${selectedIssue.identifier}...`
                  : "Ask anything..."
              }
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              style={{ maxHeight: "96px" }}
            />
            <button
              className="btn btn-primary btn-sm btn-square shrink-0"
              onClick={handleSend}
              disabled={isSending || !input.trim()}
              aria-label="Send message"
              title="Send (Enter)"
            >
              {isSending ? (
                <Loader className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] opacity-25">
              Enter to send, Shift+Enter for newline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
