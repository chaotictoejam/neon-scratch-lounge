export type CharacterClass = "TabbyWarrior" | "SiameseMage" | "MaineCoonPaladin" | "SphinxRogue";

export interface PlayerStats {
  hp: number;
  maxHp: number;
  pawStrength: number;
  agility: number;
  arcane: number;
  stealth: number;
  gold: number;
  level: number;
  xp: number;
}

export interface ActiveEffect {
  effect: string;
  turnsRemaining: number;
}

export interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
}

export interface DiceRoll {
  rolls: number[];
  modifier: number;
  statBonus: number;
  total: number;
  purpose: string;
}

export type WorkflowStepStatus = "pending" | "running" | "done" | "failed" | "retrying";

export interface WorkflowStep {
  name: string;
  label: string;
  service: string;
  status: WorkflowStepStatus;
  durationMs?: number;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface LogLine {
  timestamp: string;
  lambdaName: string;
  durationMs: number;
  success: boolean;
  errorType?: string;
  extras?: Record<string, string | number>;
}

export interface TurnMetrics {
  inputTokens: number;
  outputTokens: number;
  toolCalls: string[];
}

export interface SessionMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  retryCount: number;
  dlqDepth: number;
}

export interface NarrativeEntry {
  id: string;
  text: string;
  turnNumber: number;
}

export interface GameState {
  campaignId: string | null;
  characterName: string | null;
  characterClass: CharacterClass | null;
  playerStats: PlayerStats | null;
  inventory: string[];
  activeEffects: string[];
  location: string;
  narrativeHistory: NarrativeEntry[];
  isProcessing: boolean;
  currentTurnId: string | null;
  diceRolls: DiceRoll[];
  leveledUp: boolean;
  showLevelUp: boolean;
  gameOver: boolean;
  gameOverReason: string | null;
  turnsPlayed: number;
  combatants: Combatant[];
}

export interface CwlLogRow {
  "@timestamp"?: string;
  campaignId?: string;
  latencyMs?: string;
  toolName?: string;
  diceResult?: string;
  inputTokens?: string;
  outputTokens?: string;
  success?: string;
  retryCount?: string;
  newHp?: string;
  previousHp?: string;
  "@message"?: string;
}

export interface MechanicsState {
  workflowSteps: WorkflowStep[];
  logLines: LogLine[];
  cwlLogs: CwlLogRow[];
  currentTurnMetrics: TurnMetrics;
  sessionMetrics: SessionMetrics;
  failureInjectionActive: boolean;
}

export interface ApiTurnResponse {
  campaignId: string;
  characterName: string;
  characterClass: string;
  narrative: string;
  playerStats: PlayerStats;
  inventory: string[];
  activeEffects: string[];
  location: string;
  diceRolls: DiceRoll[];
  workflowTrace: WorkflowStep[];
  logLines: LogLine[];
  metrics: TurnMetrics;
  leveledUp: boolean;
  newLevel?: number;
  gameOver: boolean;
  gameOverReason: string | null;
  turnsPlayed: number;
  combatants?: Combatant[];
}

export type GameAction =
  | { type: "START_TURN"; turnId: string }
  | { type: "TURN_COMPLETE"; response: ApiTurnResponse }
  | { type: "NEW_GAME_STARTED"; characterClass: CharacterClass }
  | { type: "CLEAR_DICE" }
  | { type: "CLEAR_LEVEL_UP" }
  | { type: "RESET" };

export type MechanicsAction =
  | { type: "RESET_WORKFLOW" }
  | { type: "UPDATE_WORKFLOW"; steps: WorkflowStep[] }
  | { type: "STEP_STARTED"; stepName: string }
  | { type: "STEP_DONE"; stepName: string; durationMs: number }
  | { type: "STEP_FAILED"; stepName: string }
  | { type: "STEP_RETRY"; stepName: string; attempt: number; maxRetries: number }
  | { type: "ADD_LOG_LINE"; line: LogLine }
  | { type: "SET_LOG_LINES"; lines: LogLine[] }
  | { type: "SET_CWL_LOGS"; rows: CwlLogRow[] }
  | { type: "SET_TURN_METRICS"; metrics: TurnMetrics }
  | { type: "INCREMENT_RETRY" }
  | { type: "SET_DLQ_DEPTH"; depth: number }
  | { type: "INCREMENT_DLQ" }
  | { type: "TOGGLE_FAILURE_INJECTION" };

export const CLASS_META: Record<CharacterClass, {
  emoji: string;
  label: string;
  description: string;
  ability: string;
  stats: { str: number; agi: number; arc: number; stl: number };
}> = {
  TabbyWarrior: {
    emoji: "⚔️",
    label: "Tabby Warrior",
    description: "A street brawler with reinforced claws and unmatched resilience.",
    ability: "Nine Lives Surge",
    stats: { str: 8, agi: 5, arc: 2, stl: 4 },
  },
  SiameseMage: {
    emoji: "🔮",
    label: "Siamese Mage",
    description: "A silk-voiced arcanist who bends neon light into arcane force.",
    ability: "Ley Line Pulse",
    stats: { str: 3, agi: 6, arc: 9, stl: 5 },
  },
  MaineCoonPaladin: {
    emoji: "🛡️",
    label: "Maine Coon Paladin",
    description: "An armoured crusader with a Holy Hairball Shield and iron will.",
    ability: "Sacred Barrier",
    stats: { str: 6, agi: 3, arc: 5, stl: 2 },
  },
  SphinxRogue: {
    emoji: "🌙",
    label: "Sphinx Rogue",
    description: "A shadow operative. No records. No remorse. High agility and stealth.",
    ability: "Vanish Protocol",
    stats: { str: 4, agi: 9, arc: 4, stl: 9 },
  },
};

export const WORKFLOW_STEPS_DEFAULT: WorkflowStep[] = [
  { name: "RetrieveLore", label: "RetrieveLore", service: "Bedrock KB", status: "pending" },
  { name: "InvokeDungeonMaster", label: "InvokeDungeonMaster", service: "Claude 4.5", status: "pending" },
  { name: "PersistCampaign", label: "PersistCampaign", service: "DynamoDB", status: "pending" },
  { name: "FormatResponse", label: "FormatResponse", service: "Lambda", status: "pending" },
];

export const STEP_ESTIMATED_START_MS: Record<string, number> = {
  RetrieveLore: 0,
  InvokeDungeonMaster: 300,
  PersistCampaign: 8000,
  FormatResponse: 8500,
};

export const PLACEHOLDER_ACTIONS = [
  "I search the shadows for hidden passages...",
  "I attack the Roomba drone with my claws...",
  "I use my LaserPointerMk2 to distract the guard...",
  "I slip into stealth mode and scout ahead...",
  "I haggle with the NightMarket vendor...",
  "I hack the terminal with my HackingClaws...",
];
