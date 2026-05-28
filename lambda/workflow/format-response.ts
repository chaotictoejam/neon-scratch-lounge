import { FormattedResponse, WorkflowInput, DMOutput, ToolResult, DiceRollResult, WorkflowStep, LogLine, TurnMetrics } from "../shared/types";

type FormatInput = WorkflowInput & {
  dmOutput: DMOutput;
  toolResults: { result: ToolResult }[];
  validatedToolCalls: unknown[];
  loreChunks: unknown[];
  // Forwarded from invoke-dungeon-master through SFN state
  inputTokens?: number;
  outputTokens?: number;
  retryCount?: number;
  workflowTrace?: WorkflowStep[];
  logLines?: LogLine[];
  metrics?: TurnMetrics;
};

export const handler = async (input: FormatInput): Promise<FormattedResponse> => {
  const { campaign, dmOutput, toolResults } = input;

  const diceRolls: DiceRollResult[] = [];
  let leveledUp = false;
  let newLevel: number | undefined;

  for (const toolResultWrapper of toolResults ?? []) {
    const tr = toolResultWrapper?.result as ToolResult | undefined;
    if (!tr) continue;

    if (tr.toolName === "roll-dice") {
      diceRolls.push(tr.result as DiceRollResult);
    }
    if (tr.toolName === "award-xp") {
      const xpResult = tr.result as { leveledUp: boolean; newLevel: number };
      if (xpResult.leveledUp) {
        leveledUp = true;
        newLevel = xpResult.newLevel;
      }
    }
  }

  const activeEffectNames = campaign.activeEffects.map((e) => `${e.effect} (${e.turnsRemaining}t)`);

  // Build tool call list for metrics
  const toolCallNames = (toolResults ?? [])
    .map((tr) => (tr?.result as ToolResult | undefined)?.toolName)
    .filter((n): n is string => !!n);
  const toolCallsSummary = toolCallNames.reduce<string[]>((acc, name) => {
    const existing = acc.find((s) => s.startsWith(name));
    if (existing) {
      return acc.map((s) => s.startsWith(name) ? `${name} ×${parseInt(s.split("×")[1] ?? "1") + 1}` : s);
    }
    return [...acc, name];
  }, []);

  const metrics: TurnMetrics = {
    inputTokens: input.inputTokens ?? input.metrics?.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? input.metrics?.outputTokens ?? 0,
    toolCalls: toolCallsSummary,
  };

  return {
    campaignId: input.campaignId,
    characterName: campaign.characterName,
    characterClass: campaign.characterClass,
    narrative: dmOutput.narrative,
    playerStats: campaign.playerStats,
    inventory: campaign.inventory,
    activeEffects: activeEffectNames,
    location: campaign.currentLocation,
    diceRolls,
    workflowTrace: input.workflowTrace ?? [],
    logLines: input.logLines ?? [],
    metrics,
    leveledUp,
    newLevel,
    questUpdate: dmOutput.questUpdate,
    gameOver: dmOutput.gameOver,
    gameOverReason: dmOutput.gameOverReason,
    turnsPlayed: campaign.turnsPlayed,
    specialAbilityState: campaign.specialAbilityState,
    retryCount: input.retryCount ?? 0,
  };
};
