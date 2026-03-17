import { useEffect, useRef } from "react";

/**
 * Global keyboard shortcut hook.
 *
 * @param {Record<string, () => void>} shortcutMap – key → callback.
 *   Keys use the `KeyboardEvent.key` value (e.g. "n", "k", "Escape", "?").
 *
 * Shortcuts are suppressed when the user is typing inside an input,
 * textarea, select, or any element with `contenteditable`.
 */
export function useKeyboardShortcuts(shortcutMap) {
  const mapRef = useRef(shortcutMap);
  mapRef.current = shortcutMap;

  useEffect(() => {
    function handler(e) {
      // Ignore when modifier keys are held (reserved for future combos)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Ignore when user is typing in an interactive element
      const tag = e.target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        e.target?.isContentEditable
      ) {
        // Still allow Escape inside inputs (to close drawers)
        if (e.key !== "Escape") return;
      }

      const cb = mapRef.current[e.key];
      if (cb) {
        e.preventDefault();
        cb();
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
