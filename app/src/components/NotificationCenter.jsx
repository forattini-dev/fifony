import { useRef, useEffect, useCallback, useState } from "react";
import {
  Bell,
  X,
  CheckCheck,
  Play,
  Clock,
  Eye,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Pause,
  Zap,
} from "lucide-react";
import { timeAgo } from "../utils.js";

const STATE_ICONS = {
  Running: Play,
  Queued: Clock,
  "In Review": Eye,
  Done: CheckCircle,
  Blocked: AlertTriangle,
  Cancelled: XCircle,
  Interrupted: Pause,
  "token-milestone": Zap,
};

const STATE_COLORS = {
  Running: "text-info",
  Queued: "text-warning",
  "In Review": "text-accent",
  Done: "text-success",
  Blocked: "text-error",
  Cancelled: "text-base-content/40",
  Interrupted: "text-warning",
  "token-milestone": "text-secondary",
};

const BORDER_COLORS = {
  Running: "border-info",
  Queued: "border-warning",
  "In Review": "border-accent",
  Done: "border-success",
  Blocked: "border-error",
  Cancelled: "border-base-content/20",
  Interrupted: "border-warning",
  "token-milestone": "border-secondary",
};

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
}

function NotificationList({ notifications, onDismiss }) {
  return (
    <div className="max-h-80 overflow-y-auto overscroll-contain md:max-h-80 max-md:max-h-[60vh]">
      {notifications.length === 0 ? (
        <div className="py-8 text-center text-sm opacity-50">
          No notifications yet
        </div>
      ) : (
        <ul className="divide-y divide-base-200">
          {notifications.map((notif) => {
            const Icon = STATE_ICONS[notif.state] || Bell;
            const colorClass = STATE_COLORS[notif.state] || "text-base-content";
            const borderClass = BORDER_COLORS[notif.state] || "border-transparent";

            return (
              <li
                key={notif.id}
                className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-base-200/50 transition-colors border-l-2 ${
                  notif.read ? "border-transparent opacity-60" : borderClass
                }`}
                role="menuitem"
              >
                <span className={`mt-0.5 shrink-0 ${colorClass}`}>
                  <Icon className="size-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{notif.title}</p>
                  {notif.body && (
                    <p className="text-xs opacity-60 truncate">{notif.body}</p>
                  )}
                  <p className="text-[10px] opacity-40 mt-0.5">
                    {timeAgo(notif.timestamp)}
                  </p>
                </div>
                <button
                  className="btn btn-ghost btn-xs btn-circle shrink-0 opacity-40 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(notif.id);
                  }}
                  aria-label="Dismiss notification"
                >
                  <X className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MobileBottomSheet({ open, onClose, notifications, onDismiss, onMarkAllRead }) {
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef(null);
  const touchStartY = useRef(null);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 250);
  }, [onClose]);

  // Swipe down to close
  const onTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 80) handleClose();
    touchStartY.current = null;
  }, [handleClose]);

  if (!open && !closing) return null;

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/30 z-50 ${closing ? "animate-toast-out" : "animate-fade-in"}`}
        onClick={handleClose}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 bg-base-100 rounded-t-2xl shadow-2xl ${closing ? "animate-slide-down-sheet" : "animate-slide-up-sheet"}`}
        style={{ maxHeight: "70vh", paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-base-content/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-base-300">
          <span className="text-sm font-semibold">Notifications</span>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                className="btn btn-ghost btn-xs gap-1"
                onClick={onMarkAllRead}
                aria-label="Mark all as read"
              >
                <CheckCheck className="size-3" />
                Mark all read
              </button>
            )}
            <button className="btn btn-ghost btn-xs btn-circle" onClick={handleClose}>
              <X className="size-4" />
            </button>
          </div>
        </div>

        <NotificationList notifications={notifications} onDismiss={onDismiss} />
      </div>
    </>
  );
}

export function NotificationCenter({ notifications, unreadCount, onDismiss, onMarkAllRead }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const isMobile = useIsMobile();

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  // Close on click outside (desktop only)
  useEffect(() => {
    if (!open || isMobile) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, isMobile]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="btn btn-ghost btn-sm btn-circle relative"
        onClick={toggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="badge badge-xs badge-primary absolute -top-0.5 -right-0.5 animate-count-bump">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Mobile: bottom sheet */}
      {isMobile && (
        <MobileBottomSheet
          open={open}
          onClose={() => setOpen(false)}
          notifications={notifications}
          onDismiss={onDismiss}
          onMarkAllRead={onMarkAllRead}
        />
      )}

      {/* Desktop: dropdown */}
      {!isMobile && open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-base-100 rounded-box shadow-xl border border-base-300 z-50 animate-fade-in-scale"
          role="menu"
          aria-label="Notification center"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
            <span className="text-sm font-semibold">Notifications</span>
            {notifications.length > 0 && (
              <button
                className="btn btn-ghost btn-xs gap-1"
                onClick={onMarkAllRead}
                aria-label="Mark all as read"
              >
                <CheckCheck className="size-3" />
                Mark all read
              </button>
            )}
          </div>

          <NotificationList notifications={notifications} onDismiss={onDismiss} />
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
