import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { WorkflowInput, DMOutput, Campaign } from "../shared/types";
import { log } from "../shared/logger";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE!;
const MAX_CONVERSATION_HISTORY = parseInt(process.env.MAX_CONVERSATION_HISTORY ?? "20", 10);
const HISTORY_TRIM_COUNT = parseInt(process.env.HISTORY_TRIM_COUNT ?? "5", 10);
const CAMPAIGN_TTL_DAYS = parseInt(process.env.CAMPAIGN_TTL_DAYS ?? "30", 10);

type PersistInput = WorkflowInput & {
  dmOutput: DMOutput;
  toolResults: { result: { toolName: string; result: unknown } }[];
  validatedToolCalls: unknown[];
  loreChunks: unknown[];
};

function generateSummary(campaign: Campaign): string {
  const recentItems = campaign.inventory.slice(-3).join(", ") || "nothing of note";
  const lastQuest = campaign.questLog[campaign.questLog.length - 1] ?? "No active quests";
  return `Operative ${campaign.characterName}, a ${campaign.characterClass}, has survived ${campaign.turnsPlayed} turns in Neo-Pawsburg. They have neutralised ${campaign.monstersDefeated} threats, accumulated ${campaign.playerStats.gold} CreditChips, and currently operate from ${campaign.currentLocation} at ${campaign.playerStats.hp}/${campaign.playerStats.maxHp} HP. Recent acquisitions: ${recentItems}. Active quests: ${lastQuest}`;
}

export const handler = async (input: PersistInput): Promise<PersistInput> => {
  const { campaignId, action, dmOutput } = input;

  // Fetch latest campaign state (tools have mutated it in DynamoDB)
  const result = await ddb.send(new GetCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
  const campaign = result.Item as Campaign;

  // Append this turn to conversation history
  const newHistory = [
    ...campaign.conversationHistory,
    { role: "user", content: action },
    { role: "assistant", content: dmOutput.narrative },
  ];

  let campaignSummary = campaign.campaignSummary;
  let trimmedHistory = newHistory;

  // Summarize and trim if history exceeds limit
  if (newHistory.length > MAX_CONVERSATION_HISTORY * 2) {
    campaignSummary = generateSummary(campaign);
    trimmedHistory = newHistory.slice(-HISTORY_TRIM_COUNT * 2);
  }

  // Decrement active effects, remove expired
  const activeEffects = campaign.activeEffects
    .map((e) => ({ ...e, turnsRemaining: e.turnsRemaining - 1 }))
    .filter((e) => e.turnsRemaining > 0);

  // Decrement SphinxRogue vanish cooldown
  const specialAbilityState = { ...campaign.specialAbilityState };
  if (specialAbilityState.vanishCooldownTurnsLeft > 0) {
    specialAbilityState.vanishCooldownTurnsLeft -= 1;
  }

  // Reset MaineCoonPaladin shield after combat ends
  if (!dmOutput.combatOccurred) {
    specialAbilityState.shieldUsedThisEncounter = false;
  }

  const turnsPlayed = campaign.turnsPlayed + 1;
  const monstersDefeated = campaign.monstersDefeated + (dmOutput.enemyDefeated ? 1 : 0);
  const gameOver = dmOutput.gameOver;

  const updatedCampaign: Campaign = {
    ...campaign,
    conversationHistory: trimmedHistory,
    campaignSummary,
    activeEffects,
    specialAbilityState,
    turnsPlayed,
    monstersDefeated,
    gameOver,
    currentLocation: dmOutput.nextLocation ?? campaign.currentLocation,
    ttl: Math.floor(Date.now() / 1000) + CAMPAIGN_TTL_DAYS * 86400,
  };

  await ddb.send(new PutCommand({ TableName: CAMPAIGNS_TABLE, Item: updatedCampaign }));

  log({
    campaignId,
    turnsPlayed,
    monstersDefeated,
    gameOver,
    summarized: trimmedHistory.length < newHistory.length,
    activeEffectsCount: activeEffects.length,
    vanishCooldown: specialAbilityState.vanishCooldownTurnsLeft,
  });

  // Return updated campaign for format-response
  return { ...input, campaign: updatedCampaign };
};
