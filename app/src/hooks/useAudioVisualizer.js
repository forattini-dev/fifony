import { useEffect, useRef, useState, useCallback } from "react";

const BAR_COUNT = 24;

/**
 * Audio visualizer with two modes:
 * - Real mode: uses getUserMedia + AnalyserNode for actual frequency data (desktop)
 * - Simulated mode: animated random bars when getUserMedia fails or isn't available (mobile)
 *
 * Mobile Android often gives exclusive mic access — if SpeechRecognition is using the mic,
 * getUserMedia will fail. The visualizer falls back to simulated bars automatically.
 */
export function useAudioVisualizer(active) {
  const [bars, setBars] = useState(() => new Array(BAR_COUNT).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const simulatedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    rafRef.current = null;
    timerRef.current = null;
    startTimeRef.current = null;
    simulatedRef.current = false;
    setBars(new Array(BAR_COUNT).fill(0));
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (!active) {
      cleanup();
      return;
    }

    let cancelled = false;

    // Start timer immediately (works regardless of mic access)
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);

    // Try real mic visualizer, fall back to simulated
    (async () => {
      let useSimulated = true;

      try {
        if (navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = stream;

          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          ctxRef.current = audioCtx;
          if (audioCtx.state === "suspended") await audioCtx.resume();

          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.7;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          useSimulated = false;

          function tick() {
            if (cancelled) return;
            analyser.getByteFrequencyData(dataArray);
            const binCount = dataArray.length;
            const step = Math.max(1, Math.floor(binCount / BAR_COUNT));
            const newBars = [];
            for (let i = 0; i < BAR_COUNT; i++) {
              newBars.push(dataArray[Math.min(i * step, binCount - 1)] / 255);
            }
            setBars(newBars);
            rafRef.current = requestAnimationFrame(tick);
          }
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        // getUserMedia failed (permission denied, exclusive mic, no HTTPS, etc.)
      }

      // Simulated mode: random organic-looking bars
      if (useSimulated && !cancelled) {
        simulatedRef.current = true;
        const phases = Array.from({ length: BAR_COUNT }, () => Math.random() * Math.PI * 2);
        const speeds = Array.from({ length: BAR_COUNT }, () => 2 + Math.random() * 4);
        const baseAmps = Array.from({ length: BAR_COUNT }, (_, i) => {
          // Bell curve shape — higher in the middle
          const center = BAR_COUNT / 2;
          const dist = Math.abs(i - center) / center;
          return 0.3 + 0.5 * (1 - dist * dist);
        });

        function animateBars() {
          if (cancelled) return;
          const t = Date.now() / 1000;
          const newBars = phases.map((phase, i) => {
            const wave = Math.sin(t * speeds[i] + phase) * 0.3 + 0.5;
            const noise = Math.sin(t * 13.7 + i * 2.1) * 0.1;
            return Math.max(0.05, Math.min(1, baseAmps[i] * wave + noise));
          });
          setBars(newBars);
          rafRef.current = requestAnimationFrame(animateBars);
        }
        rafRef.current = requestAnimationFrame(animateBars);
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active, cleanup]);

  return { bars, elapsed };
}
