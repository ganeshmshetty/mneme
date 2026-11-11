"use client";

import { ThinkingOrb, type OrbState } from "@/components/libraries/thinking-orbs";
import type { AgentStep } from "@/lib/agent/events";

const STEP_ORB: Record<AgentStep, OrbState> = {
  "resolve-time": "weaving",
  recall: "connecting",
  plan: "weaving",
  search: "searching",
  answer: "composing",
  remember: "solving",
};

export function Orb({
  step,
  state,
  size = 20,
  className,
  label,
}: {
  step?: AgentStep;
  state?: OrbState;
  size?: 64 | 32 | 20;
  className?: string;
  label?: string;
}) {
  return (
    <ThinkingOrb
      state={state ?? (step ? STEP_ORB[step] : "breathing")}
      size={size}
      theme="auto"
      className={className}
      aria-label={label ?? (step ? undefined : "Assistant is waiting")}
      aria-hidden={label ? undefined : true}
    />
  );
}

export { ThinkingOrb };
