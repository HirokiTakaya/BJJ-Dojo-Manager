/**
 * Signup progress indicator component
 * ファイル: /components/SignupProgress.tsx
 */

"use client";

import React from "react";

interface Step {
  label: string;
  completed: boolean;
  current: boolean;
}

interface SignupProgressProps {
  steps: Step[];
  variant?: "horizontal" | "vertical";
}

export default function SignupProgress({
  steps,
  variant = "horizontal",
}: SignupProgressProps) {
  if (variant === "vertical") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {steps.map((step, index) => (
          <div key={index} style={{ display: "flex", alignItems: "flex-start" }}>
            {/* Step indicator */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: step.completed
                    ? "#22c55e"
                    : step.current
                      ? "#2563eb"
                      : "rgba(255,255,255,0.1)",
                  border: step.current ? "2px solid #2563eb" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 14,
                  fontWeight: 700,
                  transition: "all 0.2s",
                }}
              >
                {step.completed ? "✓" : index + 1}
              </div>
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  style={{
                    width: 2,
                    height: 24,
                    background: step.completed
                      ? "#22c55e"
                      : "rgba(255,255,255,0.2)",
                    transition: "background 0.2s",
                  }}
                />
              )}
            </div>
            {/* Step label */}
            <div
              style={{
                marginLeft: 12,
                paddingTop: 4,
                paddingBottom: index < steps.length - 1 ? 24 : 0,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: step.current ? 600 : 400,
                  color: step.completed
                    ? "#22c55e"
                    : step.current
                      ? "white"
                      : "rgba(255,255,255,0.5)",
                }}
              >
                {step.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Horizontal variant (default)
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        borderRadius: 12,
        background: "linear-gradient(90deg, rgba(37, 99, 235, 0.1) 0%, rgba(34, 197, 94, 0.1) 100%)",
      }}
    >
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          {/* Step circle */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: step.completed
                ? "#22c55e"
                : step.current
                  ? "#2563eb"
                  : "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
              transition: "all 0.2s",
            }}
          >
            {step.completed ? "✓" : index + 1}
          </div>
          {/* Step label */}
          <span
            style={{
              fontSize: 13,
              fontWeight: step.current ? 600 : 400,
              color: step.completed
                ? "#22c55e"
                : step.current
                  ? "white"
                  : "rgba(255,255,255,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            {step.label}
          </span>
          {/* Connector line */}
          {index < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 2,
                minWidth: 20,
                background: step.completed
                  ? "#22c55e"
                  : "rgba(255,255,255,0.2)",
                transition: "background 0.2s",
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Preset configurations
// ─────────────────────────────────────────────
export function StudentSignupProgress({
  currentStep,
}: {
  currentStep: "profile" | "login" | "verify" | "complete";
}) {
  const stepOrder = ["profile", "login", "verify", "complete"];
  const currentIndex = stepOrder.indexOf(currentStep);

  const steps: Step[] = [
    {
      label: "Profile",
      completed: currentIndex > 0,
      current: currentStep === "profile",
    },
    {
      label: "Login",
      completed: currentIndex > 1,
      current: currentStep === "login",
    },
    {
      label: "Verify",
      completed: currentIndex > 2,
      current: currentStep === "verify",
    },
    {
      label: "Complete",
      completed: currentStep === "complete",
      current: currentStep === "complete",
    },
  ];

  return <SignupProgress steps={steps} />;
}