import { useMechanics } from "../../context/MechanicsContext";
import { useGame } from "../../context/GameContext";
import { WorkflowStep, WorkflowStepStatus } from "../../types";
import { fmtMs } from "../../utils/formatters";

function StepIcon({ status }: { status: WorkflowStepStatus }) {
  switch (status) {
    case "pending":
      return <span className="text-[#6644aa] w-3 text-center select-none">○</span>;
    case "running":
      return <span className="text-[#00ffcc] w-3 text-center step-pulse select-none">◉</span>;
    case "done":
      return <span className="text-[#00ffcc] w-3 text-center select-none">✓</span>;
    case "failed":
      return <span className="text-red-400 w-3 text-center select-none">✗</span>;
    case "retrying":
      return <span className="text-red-400 w-3 text-center step-pulse select-none">◉</span>;
  }
}

function StepRow({ step }: { step: WorkflowStep }) {
  const isRetrying = step.status === "retrying";
  const isFailed = step.status === "failed";

  return (
    <div
      className={`flex items-center gap-2 text-xs py-0.5 rounded px-1 transition-all ${
        isRetrying ? "retry-flash" : ""
      } ${isFailed ? "text-red-400" : ""}`}
    >
      <StepIcon status={step.status} />
      <span
        className={`flex-1 font-mono ${
          step.status === "pending"
            ? "text-[#6644aa]"
            : step.status === "done"
            ? "text-[#00ffcc]"
            : step.status === "running"
            ? "text-[#00ffcc]"
            : "text-red-400"
        }`}
      >
        {step.label}
      </span>

      {isRetrying && (
        <span className="text-red-400 font-bold mr-1">
          ↻ RETRY {step.retryAttempt}/{step.maxRetries}
        </span>
      )}

      {step.status === "done" && step.durationMs !== undefined && step.durationMs > 0 && (
        <span className="text-[#6644aa]">{fmtMs(step.durationMs)}</span>
      )}

      <span className="text-[#6644aa]/60 text-right">[{step.service}]</span>
    </div>
  );
}

export function WorkflowTrace() {
  const { state: mechState } = useMechanics();
  const { state: gameState } = useGame();

  const totalMs = mechState.workflowSteps
    .filter((s) => s.durationMs)
    .reduce((acc, s) => acc + (s.durationMs ?? 0), 0);

  const turnId = gameState.currentTurnId?.slice(0, 8) ?? "—";

  return (
    <div className="border border-[#ff00aa]/30 rounded bg-[#0d0d18] p-3">
      <div className="flex items-center justify-between mb-2 pb-1 border-b border-[#1a1a2e]">
        <span className="text-[#ff00aa] text-xs font-bold tracking-wider uppercase text-glow-pink">
          Workflow Execution
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[#6644aa]">[turn-{turnId}]</span>
          {totalMs > 0 && (
            <span className="text-[#ffaa00]">⏱ {fmtMs(totalMs)} total</span>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {mechState.workflowSteps.map((step) => (
          <StepRow key={step.name} step={step} />
        ))}
      </div>
    </div>
  );
}
