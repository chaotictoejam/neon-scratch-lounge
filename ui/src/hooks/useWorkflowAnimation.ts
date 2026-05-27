import { useEffect, useRef } from "react";
import { useMechanics } from "../context/MechanicsContext";
import { STEP_ESTIMATED_START_MS, WORKFLOW_STEPS_DEFAULT } from "../types";

export function useWorkflowAnimation(isProcessing: boolean) {
  const { dispatch } = useMechanics();
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!isProcessing) return;

    dispatch({ type: "RESET_WORKFLOW" });

    const steps = WORKFLOW_STEPS_DEFAULT;

    steps.forEach((step) => {
      const startMs = STEP_ESTIMATED_START_MS[step.name] ?? 0;

      const startTimer = setTimeout(() => {
        dispatch({ type: "STEP_STARTED", stepName: step.name });
      }, startMs);

      timersRef.current.push(startTimer);
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [isProcessing, dispatch]);
}
