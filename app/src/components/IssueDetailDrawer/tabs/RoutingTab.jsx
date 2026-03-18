import React from "react";
import { GitBranch, Gauge, Folder, ArrowRight, Circle } from "lucide-react";
import { STATES, ISSUE_STATE_MACHINE } from "../../../utils.js";
import { Section, Field } from "../shared.jsx";
import { STATE_ICON, STATE_COLOR, STATE_BG } from "../constants.js";
import { getStateMachineOrder } from "../constants.js";

// ── filterPaths ───────────────────────────────────────────────────────────────

const INTERNAL_PATH_RE = /^(\.fifony|fifony[-_]|WORKFLOW\.local)/;

export function filterPaths(arr) {
  return (Array.isArray(arr) ? arr : []).filter((p) => !INTERNAL_PATH_RE.test(p));
}

// ── RoutingTab ────────────────────────────────────────────────────────────────

export function RoutingTab({ issue }) {
  const paths = filterPaths(issue.paths);
  const explicitSet = new Set(paths);
  const inferredPaths = filterPaths(issue.inferredPaths).filter((p) => !explicitSet.has(p));
  const overlays = Array.isArray(issue.capabilityOverlays) ? issue.capabilityOverlays : [];
  const rationale = Array.isArray(issue.capabilityRationale) ? issue.capabilityRationale : [];

  return (
    <div className="space-y-5">
      {/* State Machine */}
      <Section title="State Machine" icon={GitBranch}>
        <div className="space-y-1">
          {STATES.map((state) => {
            const isCurrent = state === issue.state;
            const Icon = STATE_ICON[state] || Circle;
            const transitions = ISSUE_STATE_MACHINE[state] || [];
            const isPast = getStateMachineOrder(state) < getStateMachineOrder(issue.state);
            return (
              <div key={state} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 border text-sm ${isCurrent ? STATE_BG[state] + " font-semibold" : isPast ? "border-transparent opacity-40" : "border-transparent opacity-60"}`}>
                <Icon className={`size-4 mt-0.5 shrink-0 ${isCurrent ? STATE_COLOR[state] : ""}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span>{state}</span>
                    {isCurrent && <span className="badge badge-xs badge-primary">current</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {transitions.map((t) => (
                      <span key={t} className="inline-flex items-center gap-0.5 text-xs opacity-50">
                        <ArrowRight className="size-2.5" />{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Capability */}
      <Section title="Capability Routing" icon={Gauge}>
        <div className="space-y-2">
          <Field label="Category" value={issue.capabilityCategory || "default"} />
          {overlays.length > 0 && (
            <div>
              <div className="text-xs opacity-50 mb-1">Overlays</div>
              <div className="flex flex-wrap gap-1">
                {overlays.map((o) => <span key={o} className="badge badge-xs badge-outline">{o}</span>)}
              </div>
            </div>
          )}
          {rationale.length > 0 && (
            <div>
              <div className="text-xs opacity-50 mb-1">Rationale</div>
              <ul className="text-xs opacity-70 list-disc ml-4 space-y-0.5">
                {rationale.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Paths */}
      {(paths.length > 0 || inferredPaths.length > 0) && (
        <Section title="Paths" icon={Folder} badge={paths.length + inferredPaths.length}>
          {paths.length > 0 && (
            <div className="mb-2">
              <div className="text-xs opacity-50 mb-1">Explicit</div>
              <div className="space-y-0.5">
                {paths.map((p) => <div key={p} className="font-mono text-xs truncate">{p}</div>)}
              </div>
            </div>
          )}
          {inferredPaths.length > 0 && (
            <div>
              <div className="text-xs opacity-50 mb-1">Inferred</div>
              <div className="space-y-0.5">
                {inferredPaths.map((p) => <div key={p} className="font-mono text-xs truncate opacity-60">{p}</div>)}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
