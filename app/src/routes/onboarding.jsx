import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const OnboardingWizard = lazy(() => import("../components/OnboardingWizard"));

function OnboardingPage() {
  const navigate = useNavigate();

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <span className="loading loading-spinner loading-lg" />
        </div>
      }
    >
      <OnboardingWizard
        onComplete={() => {
          navigate({ to: "/" });
        }}
      />
    </Suspense>
  );
}

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});
