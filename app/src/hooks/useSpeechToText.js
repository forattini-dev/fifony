import { useState, useRef, useCallback, useEffect } from "react";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

/**
 * Lightweight speech-to-text hook using the Web Speech API directly.
 * Auto-restarts on session end for continuous dictation.
 * No external dependencies — works on desktop and mobile Chrome, Edge, Safari.
 */
export function useSpeechToText({ language = "pt-BR" } = {}) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef(null);
  const activeRef = useRef(false);
  const fullTextRef = useRef(""); // accumulated text across restart sessions
  const supported = !!SpeechRecognitionAPI && (typeof window !== "undefined" && window.isSecureContext);

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onstart = null;
      try { rec.abort(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI) return;
    stopRecognition();
    activeRef.current = true;
    fullTextRef.current = "";
    setTranscript("");
    setListening(true);

    function startSession() {
      if (!activeRef.current) return;

      const rec = new SpeechRecognitionAPI();
      rec.lang = language;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;

      rec.onresult = (e) => {
        let interim = "";
        let sessionFinal = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) sessionFinal += r[0].transcript;
          else interim += r[0].transcript;
        }
        const base = fullTextRef.current;
        const sep = base && (sessionFinal || interim) ? " " : "";
        const text = base + sep + sessionFinal + (interim ? (sessionFinal ? " " : "") + interim : "");
        setTranscript(text.trimStart());
      };

      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          activeRef.current = false;
          setListening(false);
        }
      };

      rec.onend = () => {
        recognitionRef.current = null;
        if (!activeRef.current) {
          setListening(false);
          return;
        }
        // Commit: read latest transcript state to accumulate
        setTranscript((current) => {
          fullTextRef.current = current;
          return current;
        });
        // Keep listening indicator on during the restart gap
        setTimeout(startSession, 300);
      };

      try {
        rec.start();
      } catch {
        if (activeRef.current) setTimeout(startSession, 500);
      }
    }

    startSession();
  }, [stopRecognition, language]);

  const stop = useCallback(() => {
    activeRef.current = false;
    stopRecognition();
    setListening(false);
  }, [stopRecognition]);

  useEffect(() => {
    return () => { activeRef.current = false; stopRecognition(); };
  }, [stopRecognition]);

  return { supported, listening, transcript, start, stop };
}
