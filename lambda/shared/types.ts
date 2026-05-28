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

export interface SpecialAbilityState {
  nineLivesUsed: boolean;
  vanishCooldownTurnsLeft: number;
  shieldUsedThisEncounter: boolean;
}

export interface ActiveEffect {
  effect: string;
  turnsRemaining: number;
}

export interface ConversationTurn {
  role: string;
  content: string;
}

export interface Campaign {
  campaignId: string;
  playerId: string;
  characterClass: CharacterClass;
  characterName: string;
  currentLocation: string;
  playerStats: PlayerStats;
  specialAbilityState: SpecialAbilityState;
  inventory: string[];
  activeEffects: ActiveEffect[];
  conversationHistory: ConversationTurn[];
  campaignSummary: string;
  turnsPlayed: number;
  monstersDefeated: number;
  creditChipsEarned: number;
  questLog: string[];
  nineLivesUsed: boolean;
  gameOver: boolean;
  ttl: number;
}

export interface PlayerAction {
  campaignId?: string;
  playerId: string;
  action: string;
  characterClass?: CharacterClass;
}

export interface WorkflowInput {
  campaignId: string;
  playerId: string;
  action: string;
  campaign: Campaign;
  correlationId: string;
}

export interface LoreChunk {
  content: string;
  score: number;
  location?: string;
}

export interface ToolCall {
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface DMOutput {
  narrative: string;
  characterName: string;
  toolCalls: ToolCall[];
  nextLocation: string | null;
  questUpdate: string | null;
  combatOccurred: boolean;
  enemyDefeated: string | null;
  gameOver: boolean;
  gameOverReason: "death" | "victory" | null;
  dmInternalNote: string;
}

export interface DiceRollResult {
  rolls: number[];
  modifier: number;
  statBonus: number;
  total: number;
  purpose: string;
}

export interface DamageResult {
  previousHp: number;
  newHp: number;
  damageBlocked: number;
  nineLivesTrigger: boolean;
  isDead: boolean;
}

export interface InventoryResult {
  inventory: string[];
  gold: number;
  effectApplied?: string;
}

export interface XpResult {
  previousLevel: number;
  newLevel: number;
  newXp: number;
  leveledUp: boolean;
  statImproved?: string;
}

export interface LocationResult {
  previousLocation: string;
  newLocation: string;
  locationDescription: string;
}

export interface EffectResult {
  activeEffects: ActiveEffect[];
}

export interface SpecialAbilityResult {
  abilityUsed: string;
  mechanicalEffect: string;
  cooldownSet?: number;
}

export interface QuestLogResult {
  questLog: string[];
}

export interface ToolResult {
  toolName: string;
  result: DiceRollResult | DamageResult | InventoryResult | XpResult | LocationResult | EffectResult | SpecialAbilityResult | QuestLogResult;
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

export interface FormattedResponse {
  campaignId: string;
  characterName: string;
  characterClass: string;
  narrative: string;
  playerStats: PlayerStats;
  inventory: string[];
  activeEffects: string[];
  location: string;
  diceRolls: DiceRollResult[];
  workflowTrace: WorkflowStep[];
  logLines: LogLine[];
  metrics: TurnMetrics;
  leveledUp: boolean;
  newLevel?: number;
  questUpdate: string | null;
  gameOver: boolean;
  gameOverReason: string | null;
  turnsPlayed: number;
  specialAbilityState: SpecialAbilityState;
  retryCount: number;
}

export const CLASS_STARTING_STATS: Record<CharacterClass, PlayerStats> = {
  TabbyWarrior: { hp: 120, maxHp: 120, pawStrength: 8, agility: 5, arcane: 2, stealth: 4, gold: 10, level: 1, xp: 0 },
  SiameseMage: { hp: 70, maxHp: 70, pawStrength: 3, agility: 6, arcane: 9, stealth: 5, gold: 15, level: 1, xp: 0 },
  MaineCoonPaladin: { hp: 100, maxHp: 100, pawStrength: 6, agility: 3, arcane: 5, stealth: 2, gold: 20, level: 1, xp: 0 },
  SphinxRogue: { hp: 80, maxHp: 80, pawStrength: 4, agility: 9, arcane: 4, stealth: 9, gold: 25, level: 1, xp: 0 },
};

export const CHARACTER_NAMES: Record<CharacterClass, string[]> = {
  TabbyWarrior: ["Claws McGee", "Sergeant Fluffkins", "Rex Pawsworth", "Brawler McStripes"],
  SiameseMage: ["Whisper von Silk", "Madame Azurepaw", "The Blue Pointist", "Oracle Meowstein"],
  MaineCoonPaladin: ["Sir Fluffington III", "Brother Bigpaws", "The Righteous Mane", "Paladin Cheddar"],
  SphinxRogue: ["Sandpaw", "The Unnamed One", "Ghost of the Alley", "Null"],
};

export const KNOWN_LOCATIONS = [
  "NeonScratchLounge",
  "ChromeAlley",
  "RoombaCoreTower",
  "NightMarket",
  "SewersOfForgetfulness",
];

export const ALLOWED_TOOLS = [
  "roll-dice",
  "apply-damage",
  "update-inventory",
  "award-xp",
  "update-location",
  "apply-effect",
  "use-special-ability",
  "update-quest-log",
];
