import { ChevronLeft, ChevronRight, Loader2, Rocket } from "lucide-react";

function WizardNavFooter({ step, stepCount, stepName, canProceed, launching, onBack, onNext, onLaunch }) {
  if (step === 0) return null;
  return (
    <div className="relative z-10 p-4 pb-6 flex items-center max-w-2xl mx-auto w-full justify-between">
      <button
        className="btn btn-ghost gap-1"
        onClick={onBack}
        disabled={launching}
      >
        <ChevronLeft className="size-4" /> Back
      </button>

      {step < stepCount - 1 ? (
        <button
          className="btn btn-primary gap-1"
          onClick={onNext}
          disabled={!canProceed}
        >
          {stepName === "Discover Issues" ? "Continue" : "Next"} <ChevronRight className="size-4" />
        </button>
      ) : (
        <button
          className="btn btn-primary btn-lg gap-2 animate-pulse-soft"
          onClick={onLaunch}
          disabled={launching}
        >
          {launching ? (
            <>
              <Loader2 className="size-5 animate-spin" /> Launching...
            </>
          ) : (
            <>
              <Rocket className="size-5" /> Launch fifony
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default WizardNavFooter;
