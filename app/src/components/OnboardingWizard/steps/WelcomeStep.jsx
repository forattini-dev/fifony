import { ChevronRight, Sparkles, Music } from "lucide-react";

function WelcomeStep({ workspacePath, onGetStarted }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 stagger-children py-4">
      <div className="text-6xl sm:text-7xl animate-bounce-in">
        <Music className="size-16 sm:size-20 text-primary mx-auto" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
        Welcome to <span className="text-primary">fifony</span>
      </h1>
      <p className="text-base-content/60 text-lg max-w-md">
        Let's set up your AI orchestration workspace in just a few steps.
      </p>
      {workspacePath && (
        <div className="badge badge-lg badge-soft badge-primary gap-2">
          <Sparkles className="size-3.5" />
          {workspacePath}
        </div>
      )}
      <button
        className="btn btn-primary btn-lg gap-2 mt-2"
        onClick={onGetStarted}
      >
        Get Started <ChevronRight className="size-5" />
      </button>
    </div>
  );
}

export default WelcomeStep;
