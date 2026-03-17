import { useRef, useCallback } from "react";

const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Swipe-to-dismiss gesture hook for drawers/sheets.
 *
 * @param {{ onDismiss: () => void, direction?: "right" | "down", threshold?: number }} opts
 * @returns {{ handlers: { onTouchStart, onTouchMove, onTouchEnd }, ref: React.RefObject }}
 */
export function useSwipeToDismiss({ onDismiss, direction = "right", threshold = 80 }) {
  const elRef = useRef(null);
  const startRef = useRef(null);
  const activeRef = useRef(false);

  const isHorizontal = direction === "right" || direction === "left";
  const sign = direction === "right" || direction === "down" ? 1 : -1;

  const onTouchStart = useCallback((e) => {
    // Only track single-finger touches
    if (e.touches.length !== 1) return;

    // If direction is "right" and there's scrollable content, only start if at scroll left = 0
    const el = elRef.current;
    if (el && direction === "right" && el.scrollLeft > 0) return;
    if (el && direction === "down" && el.scrollTop > 0) return;

    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY };
    activeRef.current = false;
  }, [direction]);

  const onTouchMove = useCallback((e) => {
    if (!startRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startRef.current.x;
    const dy = touch.clientY - startRef.current.y;

    const delta = isHorizontal ? dx * sign : dy * sign;
    const cross = isHorizontal ? Math.abs(dy) : Math.abs(dx);

    // If cross-axis movement > main axis, abort — user is scrolling
    if (!activeRef.current && cross > Math.abs(isHorizontal ? dx : dy)) {
      startRef.current = null;
      return;
    }

    // Only activate after 10px in the right direction
    if (!activeRef.current) {
      if (delta < 10) return;
      activeRef.current = true;
    }

    const clamped = Math.max(0, delta);
    const el = elRef.current;
    if (!el || REDUCED_MOTION) return;

    const prop = isHorizontal ? "translateX" : "translateY";
    el.style.transform = `${prop}(${clamped}px)`;
    el.style.opacity = String(Math.max(0.3, 1 - clamped / 300));
    el.style.transition = "none";
  }, [isHorizontal, sign]);

  const onTouchEnd = useCallback(() => {
    if (!startRef.current) return;
    const el = elRef.current;
    startRef.current = null;

    if (!el) {
      activeRef.current = false;
      return;
    }

    // Read current transform to see how far we swiped
    const match = el.style.transform.match(/([-\d.]+)px/);
    const delta = match ? parseFloat(match[1]) : 0;

    if (delta > threshold) {
      // Dismiss — animate out
      const prop = isHorizontal ? "translateX" : "translateY";
      el.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
      el.style.transform = `${prop}(${isHorizontal ? "100%" : "100%"})`;
      el.style.opacity = "0";
      setTimeout(() => onDismiss(), 200);
    } else {
      // Spring back
      el.style.transition = "transform 0.3s cubic-bezier(0.34, 1.3, 0.64, 1), opacity 0.3s ease";
      el.style.transform = "";
      el.style.opacity = "";
    }

    activeRef.current = false;
  }, [threshold, isHorizontal, onDismiss]);

  return {
    ref: elRef,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}

export default useSwipeToDismiss;
