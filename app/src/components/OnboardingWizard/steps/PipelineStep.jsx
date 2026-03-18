import { Rocket, ChevronRight, Loader2, CircleCheck, CircleX } from "lucide-react";
import { PIPELINE_ROLES } from "../constants";

function PipelineStep({ providers, providersLoading, pipeline, setPipeline }) {
  const providerList = Array.isArray(providers) ? providers : [];
  const availableProviders = providerList.filter((p) => p.available !== false);

  return (
    <div className="flex flex-col gap-6 stagger-children">
      <div className="text-center">
        <Rocket className="size-10 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">Agent Pipeline</h2>
        <p className="text-base-content/60 mt-1">Choose which CLI runs each stage of the pipeline</p>
      </div>

      {providersLoading ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-base-content/50">Detecting available CLIs...</p>
        </div>
      ) : availableProviders.length === 0 ? (
        <div className="alert alert-warning text-sm">
          No providers detected. Make sure claude or codex CLI is installed.
        </div>
      ) : (
        <>
          {/* Provider status */}
          <div className="flex flex-wrap gap-2 justify-center">
            {providerList.map((prov) => {
              const name = prov.id || prov.name || prov;
              const available = prov.available !== false;
              return (
                <span key={name} className={`badge badge-lg gap-2 ${available ? "badge-success" : "badge-ghost opacity-50"}`}>
                  {available ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                  {name}
                  {prov.path && <span className="font-mono text-[10px] opacity-60 hidden sm:inline">{prov.path}</span>}
                </span>
              );
            })}
          </div>

          {/* Pipeline flow */}
          <div className="flex flex-col items-center gap-2">
            {PIPELINE_ROLES.map((r, i) => {
              const Icon = r.icon;
              const selected = pipeline[r.role] || availableProviders[0]?.name || "";
              return (
                <div key={r.role} className="w-full">
                  {i > 0 && (
                    <div className="flex justify-center py-1">
                      <ChevronRight className="size-5 rotate-90 opacity-30" />
                    </div>
                  )}
                  <div className="card bg-base-200">
                    <div className="card-body p-4 flex-row items-center gap-4">
                      <div className={`size-10 rounded-full flex items-center justify-center bg-base-300 ${r.color}`}>
                        <Icon className="size-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{r.label}</div>
                        <p className="text-xs text-base-content/50">{r.description}</p>
                      </div>
                      <select
                        className="select select-bordered select-sm w-32"
                        value={selected}
                        onChange={(e) => setPipeline((prev) => ({ ...prev, [r.role]: e.target.value }))}
                      >
                        {availableProviders.map((p) => {
                          const name = p.id || p.name || p;
                          return <option key={name} value={name}>{name}</option>;
                        })}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-base-content/40 text-center max-w-md mx-auto">
            Each stage can use a different CLI. The pipeline flows top to bottom: plan, then execute, then review.
          </p>
        </>
      )}
    </div>
  );
}

export default PipelineStep;
