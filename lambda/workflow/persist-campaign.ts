import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { WorkflowInput, DMOutput, Campaign, ConversationTurn } from "../shared/types";
import { log, logError } from "../shared/logger";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" });

const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-sonnet-4-20250514";
const MAX_CONVERSATION_HISTORY = parseInt(process.env.MAX_CONVERSATION_HISTORY ?? "20", 10);
const HISTORY_TRIM_COUNT = parseInt(process.env.HISTORY_TRIM_COUNT ?? "5", 10);
const CAMPAIGN_TTL_DAYS = parseInt(process.env.CAMPAIGN_TTL_DAYS ?? "30", 10);

type PersistInput = WorkflowInput & {
  dmOutput: DMOutput;
  toolResults: { result: { toolName: string; result: unknown } }[];
  validatedToolCalls: unknown[];
  loreChunks: unknown[];
};

async function summarize(campaign: Campaign, history: ConversationTurn[]): Promise<string> {
  const historyText = history.map((t) => `${t.role}: ${t.content}`).join("\n");

  const requestBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 256,
    system: "You are summarizing a cyberpunk cat RPG campaign for long-term memory. Be concise and focus on plot-relevant facts, character state, and completed objectives. Never break the game world fiction.",
    messages: [{
      role: "user",
      content: `Summarize this campaign history in 3-4 sentences, preserving key facts about ${campaign.characterName}'s journey, current objectives, and important discoveries:\n\n${historyText}`,
    }],
  };

  const response = await bedrock.send(new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody),
  }));

  const body = JSON.parse(new TextDecoder().decode(response.body));
  return body.content?.[0]?.text ?? fallbackSummary(campaign);
}

function fallbackSummary(campaign: Campaign): string {
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
  const newHistory: ConversationTurn[] = [
    ...campaign.conversationHistory,
    { role: "user", content: action },
    { role: "assistant", content: dmOutput.narrative },
  ];

  let campaignSummary = campaign.campaignSummary;
  let trimmedHistory = newHistory;

  // Summarize with Bedrock and trim when history exceeds limit
  if (newHistory.length > MAX_CONVERSATION_HISTORY) {
    try {
      campaignSummary = await summarize(campaign, newHistory);
    } catch (err) {
      logError({ campaignId, error: "Bedrock summarize failed, using fallback", detail: String(err) });
      campaignSummary = fallbackSummary(campaign);
    }
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
    success: true,
  });

  // Return updated campaign for format-response
  return { ...input, campaign: updatedCampaign };
};
