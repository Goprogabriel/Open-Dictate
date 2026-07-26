import { act, fireEvent, render, screen } from "@testing-library/react";

import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { changeLocale } from "@/locales";
import { setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

describe("OnboardingFlow", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    setCurrentAuthSession(null);
    useOnboardingStore.getState().reset();
    usePreferencesStore.getState().reset();
    await changeLocale("en");
  });

  it("presents the welcome screen with a clear primary action", () => {
    render(<OnboardingFlow />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome to Open Dictate" }),
    ).toBeVisible();
    expect(screen.getByText("Step 1 of 6")).toBeVisible();
    expect(screen.getByRole("button", { name: "Get started" })).toBeEnabled();
  });

  it("moves from welcome through language selection and mode selection to setup", () => {
    render(<OnboardingFlow />);

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(screen.getByRole("heading", { level: 1, name: "Choose your languages" })).toBeVisible();
    expect(screen.getByLabelText("App language")).toHaveValue("en");
    expect(screen.getByLabelText("Primary spoken language")).toHaveValue("en");
    expect(screen.getByText("Step 2 of 6")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Primary spoken language"), {
      target: { value: "da" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Choose how to use Open Dictate",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Use my API key" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Set up Local AI" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
    expect(screen.getByText("Step 3 of 6")).toBeVisible();
    expect(usePreferencesStore.getState().transcriptionLanguage).toBe("da");

    fireEvent.click(screen.getByRole("button", { name: "Use my API key" }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Connect your OpenAI API key",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("OpenAI API key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Test and continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show key" })).toBeEnabled();
    expect(screen.getByText("Step 4 of 6")).toBeVisible();
  });

  it("offers local quality tiers without requiring account credentials", async () => {
    useOnboardingStore.setState({ completed: false, mode: "local", step: 3 });

    await act(async () => {
      render(<OnboardingFlow />);
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Choose Local AI quality" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Low.*2\.3 GB/su })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Medium.*4\.0 GB/su })).toBeEnabled();
    expect(screen.getByRole("button", { name: /High.*6\.7 GB/su })).toBeEnabled();
    expect(screen.queryByLabelText("OpenAI API key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("adds subscription before permissions only for the Pro path", async () => {
    useOnboardingStore.setState({ completed: false, mode: "pro", step: 4 });
    const { unmount } = render(<OnboardingFlow />);

    expect(screen.getByRole("heading", { level: 1, name: "Start Open Dictate Pro" })).toBeVisible();
    expect(screen.getByText("$5 per month")).toBeVisible();
    expect(screen.getByText("Step 5 of 7")).toBeVisible();

    unmount();
    useOnboardingStore.setState({ completed: false, mode: "free", step: 4 });
    await act(async () => {
      render(<OnboardingFlow />);
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Allow Open Dictate to work everywhere",
      }),
    ).toBeVisible();
    expect(screen.queryByText("$5 per month")).not.toBeInTheDocument();
    expect(screen.getByText("Step 5 of 6")).toBeVisible();
  });
});
