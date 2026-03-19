import { Rocket, Loader2 } from "lucide-react";

function CompleteStep({ config, launching }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 stagger-children py-4">
      <div className="animate-bounce-in">
        <Rocket className="size-16 sm:size-20 text-primary mx-auto" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold">You're All Set!</h2>
      <p className="text-base-content/60 max-w-md">
        Here's a summary of your configuration. Hit launch when you're ready.
      </p>

      <div className="card bg-base-200 w-full max-w-sm">
        <div className="card-body p-4 gap-2 text-sm text-left">
          <div className="flex justify-between gap-4">
            <span className="text-base-content/60">Queue title</span>
            <span className="font-semibold text-right break-words">{config.queueTitle || "fifony"}</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Pipeline</span>
            <span className="font-semibold capitalize text-xs font-mono">
              {config.pipeline?.planner || "?"} → {config.pipeline?.executor || "?"} → {config.pipeline?.reviewer || "?"}
            </span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Domains</span>
            <span className="font-semibold">
              {config.domains?.length > 0 ? config.domains.length + " selected" : "none"}
            </span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Agents</span>
            <span className="font-semibold">{config.agents?.length || 0} to install</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Skills</span>
            <span className="font-semibold">{config.skills?.length || 0} to install</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Plan</span>
            <span className="font-semibold capitalize">{config.efforts.planner}</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Execute</span>
            <span className="font-semibold capitalize">{config.efforts.executor}</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Review</span>
            <span className="font-semibold capitalize">{config.efforts.reviewer}</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Workers</span>
            <span className="font-semibold">{config.concurrency}</span>
          </div>
          <div className="divider my-0" />
          <div className="flex justify-between">
            <span className="text-base-content/60">Theme</span>
            <span className="font-semibold capitalize">{config.theme}</span>
          </div>
        </div>
      </div>

      {launching && (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <Loader2 className="size-4 animate-spin" />
          Saving configuration & installing agents...
        </div>
      )}
    </div>
  );
}

export default CompleteStep;
