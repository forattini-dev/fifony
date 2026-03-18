function StepContent({ direction, stepKey, center, children }) {
  const animClass = direction === "forward" ? "animate-slide-in-right" : "animate-slide-in-left";
  return (
    <div key={stepKey} className={`${animClass} w-full max-w-2xl mx-auto ${center ? "my-auto" : ""}`}>
      {children}
    </div>
  );
}

export default StepContent;
