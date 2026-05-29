import { createContext, useContext, useReducer, ReactNode } from "react";
import { MechanicsState, MechanicsAction, WORKFLOW_STEPS_DEFAULT, WorkflowStep } from "../types";

const initialState: MechanicsState = {
  workflowSteps: WORKFLOW_STEPS_DEFAULT.map((s) => ({ ...s })),
  logLines: [],
  cwlLogs: [],
  currentTurnMetrics: { inputTokens: 0, outputTokens: 0, toolCalls: [] },
  sessionMetrics: { totalInputTokens: 0, totalOutputTokens: 0, retryCount: 0, dlqDepth: 0 },
  failureInjectionActive: false,
};

function mechanicsReducer(state: MechanicsState, action: MechanicsAction): MechanicsState {
  switch (action.type) {
    case "RESET_WORKFLOW":
      return {
        ...state,
        workflowSteps: WORKFLOW_STEPS_DEFAULT.map((s) => ({ ...s })),
        logLines: [],
        currentTurnMetrics: { inputTokens: 0, outputTokens: 0, toolCalls: [] },
      };

    case "UPDATE_WORKFLOW":
      return { ...state, workflowSteps: action.steps };

    case "STEP_STARTED":
      return {
        ...state,
        workflowSteps: state.workflowSteps.map((s) =>
          s.name === action.stepName ? { ...s, status: "running" } : s
        ),
      };

    case "STEP_DONE":
      return {
        ...state,
        workflowSteps: state.workflowSteps.map((s) =>
          s.name === action.stepName ? { ...s, status: "done", durationMs: action.durationMs } : s
        ),
      };

    case "STEP_RETRY":
      return {
        ...state,
        workflowSteps: state.workflowSteps.map((s) =>
          s.name === action.stepName
            ? { ...s, status: "retrying", retryAttempt: action.attempt, maxRetries: action.maxRetries }
            : s
        ),
      };

    case "ADD_LOG_LINE":
      return { ...state, logLines: [...state.logLines.slice(-49), action.line] };

    case "SET_LOG_LINES":
      return { ...state, logLines: action.lines };

    case "SET_CWL_LOGS":
      return { ...state, cwlLogs: action.rows };

    case "SET_TURN_METRICS": {
      const m = action.metrics;
      return {
        ...state,
        currentTurnMetrics: m,
        sessionMetrics: {
          ...state.sessionMetrics,
          totalInputTokens: state.sessionMetrics.totalInputTokens + m.inputTokens,
          totalOutputTokens: state.sessionMetrics.totalOutputTokens + m.outputTokens,
        },
      };
    }

    case "INCREMENT_RETRY":
      return {
        ...state,
        sessionMetrics: { ...state.sessionMetrics, retryCount: state.sessionMetrics.retryCount + 1 },
      };

    case "SET_DLQ_DEPTH":
      return { ...state, sessionMetrics: { ...state.sessionMetrics, dlqDepth: action.depth } };

    case "INCREMENT_DLQ":
      return {
        ...state,
        sessionMetrics: { ...state.sessionMetrics, dlqDepth: state.sessionMetrics.dlqDepth + 1 },
      };

    case "TOGGLE_FAILURE_INJECTION":
      return { ...state, failureInjectionActive: !state.failureInjectionActive };

    default:
      return state;
  }
}

interface MechanicsContextValue {
  state: MechanicsState;
  dispatch: React.Dispatch<MechanicsAction>;
  getStepByName: (name: string) => WorkflowStep | undefined;
}

const MechanicsContext = createContext<MechanicsContextValue | null>(null);

export function MechanicsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(mechanicsReducer, initialState);

  const getStepByName = (name: string) => state.workflowSteps.find((s) => s.name === name);

  return (
    <MechanicsContext.Provider value={{ state, dispatch, getStepByName }}>
      {children}
    </MechanicsContext.Provider>
  );
}

export function useMechanics() {
  const ctx = useContext(MechanicsContext);
  if (!ctx) throw new Error("useMechanics must be used within MechanicsProvider");
  return ctx;
}
