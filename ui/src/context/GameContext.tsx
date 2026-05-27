import { createContext, useContext, useReducer, useCallback, ReactNode } from "react";
import { GameState, GameAction, ApiTurnResponse, CharacterClass, NarrativeEntry } from "../types";
import { v4 as uuidv4 } from "../utils/uuid";

const initialState: GameState = {
  campaignId: null,
  characterName: null,
  characterClass: null,
  playerStats: null,
  inventory: [],
  activeEffects: [],
  location: "",
  narrativeHistory: [],
  isProcessing: false,
  currentTurnId: null,
  diceRolls: [],
  leveledUp: false,
  showLevelUp: false,
  gameOver: false,
  gameOverReason: null,
  turnsPlayed: 0,
};

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START_TURN":
      return { ...state, isProcessing: true, currentTurnId: action.turnId, diceRolls: [], leveledUp: false };

    case "TURN_COMPLETE": {
      const r = action.response;
      const entry: NarrativeEntry = {
        id: uuidv4(),
        text: r.narrative,
        turnNumber: r.turnsPlayed,
      };
      const history = [...state.narrativeHistory, entry].slice(-4);
      return {
        ...state,
        isProcessing: false,
        currentTurnId: null,
        campaignId: r.campaignId,
        characterName: r.characterName,
        characterClass: r.characterClass as CharacterClass,
        playerStats: r.playerStats,
        inventory: r.inventory,
        activeEffects: r.activeEffects,
        location: r.location,
        narrativeHistory: history,
        diceRolls: r.diceRolls ?? [],
        leveledUp: r.leveledUp,
        showLevelUp: r.leveledUp,
        gameOver: r.gameOver,
        gameOverReason: r.gameOverReason,
        turnsPlayed: r.turnsPlayed,
      };
    }

    case "NEW_GAME_STARTED":
      return {
        ...initialState,
        isProcessing: true,
        characterClass: action.characterClass,
      };

    case "CLEAR_DICE":
      return { ...state, diceRolls: [] };

    case "CLEAR_LEVEL_UP":
      return { ...state, showLevelUp: false };

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

interface GameContextValue {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  applyTurnResponse: (response: ApiTurnResponse) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const applyTurnResponse = useCallback((response: ApiTurnResponse) => {
    dispatch({ type: "TURN_COMPLETE", response });
  }, []);

  return (
    <GameContext.Provider value={{ state, dispatch, applyTurnResponse }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
