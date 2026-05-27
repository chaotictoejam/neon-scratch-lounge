import { FormattedResponse, WorkflowInput, DMOutput, ToolResult, DiceRollResult } from "../shared/types";

type FormatInput = WorkflowInput & {
  dmOutput: DMOutput;
  toolResults: { result: ToolResult }[];
  validatedToolCalls: unknown[];
  loreChunks: unknown[];
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
    leveledUp,
    newLevel,
    questUpdate: dmOutput.questUpdate,
    gameOver: dmOutput.gameOver,
    gameOverReason: dmOutput.gameOverReason,
    turnsPlayed: campaign.turnsPlayed,
    specialAbilityState: campaign.specialAbilityState,
  };
};
