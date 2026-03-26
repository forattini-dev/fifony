import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";

/**
 * Fetches all dev server statuses and polls every 3s.
 * Simple polling is more predictable than WS+fallback and avoids
 * the race condition where WS connects but no refresh is triggered.
 */
export function useDevServers() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get("/dev-server");
      if (res?.servers) setServers(res.servers);
    } catch {
      /* non-critical */
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Poll every 3s — endpoint is cheap (reads PID files only)
  useEffect(() => {
    const id = setInterval(fetchAll, 3_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { servers, loading, refresh: fetchAll };
}

/**
 * Polling-based log viewer for a single dev server.
 * Fetches the full tail on mount, then polls for new bytes every 2s.
 * Returns { log, connected } — connected = true once first fetch succeeds.
 */
export function useDevServerLog(id, enabled = false) {
  const [log, setLog] = useState("");
  const [connected, setConnected] = useState(false);
  const sizeRef = useRef(0);

  useEffect(() => {
    if (!enabled || !id) {
      setLog("");
      setConnected(false);
      sizeRef.current = 0;
      return;
    }

    let alive = true;

    const fetchLog = async () => {
      if (!alive) return;
      try {
        const after = sizeRef.current;
        const res = after > 0
          ? await api.get(`/dev-server/${id}/log?after=${after}`)
          : await api.get(`/dev-server/${id}/log`);
        if (!alive) return;

        if (after > 0 && res.text !== undefined) {
          // Incremental: append new bytes
          if (res.text) setLog((prev) => prev + res.text);
        } else if (res.logTail !== undefined) {
          // Full tail (first load or re-init)
          setLog(res.logTail ?? "");
          if (res.truncated) {
            setLog((prev) => `[... ${Math.round((res.logSize - 16384) / 1024)}KB truncated ...]\n${prev}`);
          }
        }

        if (res.logSize !== undefined) sizeRef.current = res.logSize;
        setConnected(true);
      } catch {
        if (!alive) return;
        setConnected(false);
      }
    };

    // Fetch immediately, then poll every 2s
    fetchLog();
    const intervalId = setInterval(fetchLog, 2_000);

    return () => {
      alive = false;
      clearInterval(intervalId);
      setConnected(false);
      sizeRef.current = 0;
    };
  }, [id, enabled]);

  return { log, connected };
}
