// FILE: CediaRuntimeModelState.tsx
// Purpose: Show the runtime's own model and effort facts next to the shared picker.
// Layer: Chat composer presentation

import type { CediaModelStateAnswer } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";

function runtimeModelLabel(model: Extract<CediaModelStateAnswer, { available: true }>["model"]): string {
  return model === null ? "unknown" : `${model.provider}/${model.id}`;
}

function sameRuntimeModel(
  sentModel: string | undefined,
  runtimeModel: Extract<CediaModelStateAnswer, { available: true }>["model"],
): boolean {
  if (!sentModel || runtimeModel === null) return false;
  return sentModel === runtimeModel.id || sentModel === `${runtimeModel.provider}/${runtimeModel.id}`;
}

export function runtimeEffortLabels(
  effort: Extract<CediaModelStateAnswer, { available: true }>["effort"],
): readonly string[] {
  const configured = effort.configured ?? "unknown";
  if (!effort.isAuto) return [`Configured effort: ${configured}`];
  return [
    `Configured effort: ${configured}`,
    `Auto · resolved: ${effort.autoResolved ?? "unknown"}`,
  ];
}

export function CediaRuntimeModelStateNotice({
  state,
  sentModel,
  className,
}: {
  readonly state: CediaModelStateAnswer;
  readonly sentModel?: string;
  readonly className?: string;
}) {
  if (state.available === false) {
    return (
      <div className={cn("border-b border-border px-3 py-2 text-xs text-muted-foreground", className)}>
        Runtime model state unavailable: {state.reason}
      </div>
    );
  }

  const modelLabel = runtimeModelLabel(state.model);
  const modelChanged = !sameRuntimeModel(sentModel, state.model);
  return (
    <div
      className={cn("border-b border-border px-3 py-2 text-xs text-muted-foreground", className)}
      data-runtime-model-state="available"
    >
      <div className="font-medium text-foreground">Runtime selection</div>
      <div>Model: {modelLabel}</div>
      {modelChanged && state.model !== null ? (
        <div>Runtime model differs from this window: {modelLabel}</div>
      ) : null}
      {runtimeEffortLabels(state.effort).map((label) => (
        <div key={label}>{label}</div>
      ))}
    </div>
  );
}
