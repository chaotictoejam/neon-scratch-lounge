import { useCallback, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { useMechanics } from "../context/MechanicsContext";
import { sendAction, injectFailure, clearFailure, fetchCampaignLogs } from "../utils/api";
import { CharacterClass } from "../types";
import { v4 as uuidv4 } from "../utils/uuid";

export function useApi() {
  const { state: gameState, dispatch: gameDispatch } = useGame();
  const { dispatch: mechDispatch, state: mechState } = useMechanics();

  // Keyboard shortcut: Ctrl+Shift+F toggles failure injection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        mechDispatch({ type: "TOGGLE_FAILURE_INJECTION" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mechDispatch]);

  const submitAction = useCallback(
    async (action: string, characterClass?: CharacterClass) => {
      if (gameState.isProcessing) return;

      const turnId = uuidv4();
      const wasFailureInjected = mechState.failureInjectionActive;

      if (characterClass) {
        gameDispatch({ type: "NEW_GAME_STARTED", characterClass });
      } else {
        gameDispatch({ type: "START_TURN", turnId });
      }
      mechDispatch({ type: "RESET_WORKFLOW" });

      try {
        if (wasFailureInjected) {
          await injectFailure().catch((e) => console.warn("Failed to inject failure:", e));
          mechDispatch({ type: "INCREMENT_DLQ" });
          mechDispatch({ type: "STEP_RETRY", stepName: "ExecuteTools", attempt: 1, maxRetries: 3 });
          mechDispatch({ type: "INCREMENT_RETRY" });
        }

        const response = await sendAction({
          campaignId: gameState.campaignId,
          action,
          characterClass,
        });

        // Apply actual workflow trace from response
        if (response.workflowTrace?.length) {
          mechDispatch({ type: "UPDATE_WORKFLOW", steps: response.workflowTrace });
        } else {
          // Mark all as done with estimated times when trace not available
          ["RetrieveLore", "InvokeDungeonMaster", "ValidateAndRoute", "ExecuteTools", "PersistCampaign", "FormatResponse"].forEach((name) => {
            mechDispatch({ type: "STEP_DONE", stepName: name, durationMs: 0 });
          });
        }

        if (response.logLines?.length) {
          mechDispatch({ type: "SET_LOG_LINES", lines: response.logLines });
        }

        if (response.metrics) {
          mechDispatch({ type: "SET_TURN_METRICS", metrics: response.metrics });
        }

        gameDispatch({ type: "TURN_COMPLETE", response });

        if (response.campaignId) {
          fetchCampaignLogs(response.campaignId)
            .then(({ rows }) => mechDispatch({ type: "SET_CWL_LOGS", rows }))
            .catch((e) => console.warn("fetchCampaignLogs failed:", e));
        }
      } catch (err) {
        console.error("Turn failed:", err);
        gameDispatch({
          type: "TURN_COMPLETE",
          response: {
            campaignId: gameState.campaignId ?? "",
            characterName: gameState.characterName ?? "Unknown",
            characterClass: gameState.characterClass ?? "SphinxRogue",
            narrative:
              "The neon flickers and goes dark for a moment. The city holds its breath. Your campaign continues, operative — but the system needs a moment to recover. Try your action again.",
            playerStats: gameState.playerStats ?? {
              hp: 0, maxHp: 0, pawStrength: 0, agility: 0, arcane: 0, stealth: 0, gold: 0, level: 1, xp: 0,
            },
            inventory: gameState.inventory,
            activeEffects: gameState.activeEffects,
            location: gameState.location,
            diceRolls: [],
            workflowTrace: [],
            logLines: [],
            metrics: { inputTokens: 0, outputTokens: 0, toolCalls: [] },
            leveledUp: false,
            gameOver: false,
            gameOverReason: null,
            turnsPlayed: gameState.turnsPlayed,
          },
        });
      } finally {
        if (wasFailureInjected) {
          mechDispatch({ type: "TOGGLE_FAILURE_INJECTION" });
          await clearFailure().catch((e) => console.warn("Failed to clear failure injection:", e));
        }
      }
    },
    [gameState, gameDispatch, mechDispatch, mechState.failureInjectionActive]
  );

  return { submitAction };
}
