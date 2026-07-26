import { LanguageStep } from "@/features/onboarding/LanguageStep";
import { ModeStep } from "@/features/onboarding/ModeStep";
import { OnboardingShell } from "@/features/onboarding/OnboardingShell";
import { PermissionStep } from "@/features/onboarding/PermissionStep";
import { PracticeStep } from "@/features/onboarding/PracticeStep";
import { SetupStep } from "@/features/onboarding/SetupStep";
import { SubscriptionStep } from "@/features/onboarding/SubscriptionStep";
import { WelcomeStep } from "@/features/onboarding/WelcomeStep";
import { useOnboardingStore } from "@/stores/onboardingStore";
import type { UserMode } from "@/types/domain";

export function OnboardingFlow() {
  const step = useOnboardingStore((state) => state.step);
  const mode = useOnboardingStore((state) => state.mode);
  const setStep = useOnboardingStore((state) => state.setStep);
  const setMode = useOnboardingStore((state) => state.setMode);
  const complete = useOnboardingStore((state) => state.complete);

  const chooseMode = (selected: UserMode) => {
    setMode(selected);
    setStep(3);
  };

  let content;
  if (step === 0) {
    content = <WelcomeStep onContinue={() => setStep(1)} />;
  } else if (step === 1) {
    content = <LanguageStep onBack={() => setStep(0)} onContinue={() => setStep(2)} />;
  } else if (step === 2) {
    content = <ModeStep onBack={() => setStep(1)} onSelect={chooseMode} />;
  } else if (step === 3 && mode) {
    content = (
      <SetupStep
        mode={mode}
        onBack={() => setStep(2)}
        onContinue={(options) => setStep(mode === "pro" && options?.subscriptionActive ? 5 : 4)}
      />
    );
  } else if (step === 4 && mode === "pro") {
    content = <SubscriptionStep onBack={() => setStep(3)} onContinue={() => setStep(5)} />;
  } else if ((step === 4 && mode !== "pro") || (step === 5 && mode === "pro")) {
    content = (
      <PermissionStep
        onBack={() => setStep(mode === "pro" ? 4 : 3)}
        onContinue={() => setStep(mode === "pro" ? 6 : 5)}
      />
    );
  } else if ((step === 5 && mode !== "pro") || (step === 6 && mode === "pro")) {
    content = <PracticeStep onBack={() => setStep(mode === "pro" ? 5 : 4)} onFinish={complete} />;
  } else {
    content = <WelcomeStep onContinue={() => setStep(1)} />;
  }

  return (
    <OnboardingShell step={step} totalSteps={mode === "pro" ? 7 : 6}>
      {content}
    </OnboardingShell>
  );
}
