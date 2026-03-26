import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";

/**
 * Fetches all service statuses and polls at `pollInterval` ms.
 * Pass `pollInterval: false` (or 0) to disable polling — use when WS is connected.
 */
export function useServices({ pollInterval = 3_000 } = {}) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get("/services");
      if (res?.services) setServices(res.services);
    } catch {
      /* non-critical */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!pollInterval) return;
    const id = setInterval(fetchAll, pollInterval);
    return () => clearInterval(id);
  }, [fetchAll, pollInterval]);

  return { services, loading, refresh: fetchAll };
}

/**
 * Polls the log endpoint every second for live log delivery.
 * Uses incremental fetching (?after=N) to avoid re-sending the entire log.
 * Returns { log, connected } — connected = true once first data arrives.
 */
export function useServiceLog(id, enabled = false) {
  const [log, setLog] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const sizeRef = useRef(0);

  useEffect(() => {
    if (!enabled || !id) {
      setLog("");
      setConnected(false);
      setError(null);
      sizeRef.current = 0;
      return;
    }

    let alive = true;
    sizeRef.current = 0;
    setError(null);

    const fetchLog = async () => {
      if (!alive) return;
      try {
        const after = sizeRef.current;
        const encId = encodeURIComponent(id);
        const res = after > 0
          ? await api.get(`/services/${encId}/log?after=${after}`)
          : await api.get(`/services/${encId}/log`);
        if (!alive) return;

        if (after > 0 && res.text !== undefined) {
          if (res.text) setLog((prev) => prev + res.text);
        } else if (res.logTail !== undefined) {
          setLog(res.logTail ?? "");
        }

        if (res.logSize !== undefined) sizeRef.current = res.logSize;
        setError(null);
        setConnected(true);
      } catch (err) {
        if (!alive) return;
        setConnected(false);
        setError(err instanceof Error ? err.message : "Failed to load logs.");
      }
    };

    fetchLog();
    const intervalId = setInterval(fetchLog, 1_000);

    return () => {
      alive = false;
      clearInterval(intervalId);
      setConnected(false);
      setError(null);
      sizeRef.current = 0;
    };
  }, [id, enabled]);

  return { log, connected, error };
}
