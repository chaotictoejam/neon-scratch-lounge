import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { FormattedResponse, WorkflowInput, DMOutput, ToolResult, DiceRollResult, WorkflowStep, LogLine, TurnMetrics } from "../shared/types";
import { log } from "../shared/logger";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TURN_RESULTS_TABLE = process.env.TURN_RESULTS_TABLE ?? "";

type FormatInput = WorkflowInput & {
  dmOutput: DMOutput;
  toolResults: { result: ToolResult }[];
  validatedToolCalls: unknown[];
  loreChunks: unknown[];
  // Forwarded from invoke-dungeon-master through SFN state
  inputTokens?: number;
  outputTokens?: number;
  retryCount?: number;
  startedAt?: number;
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

  const result: FormattedResponse = {
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

  if (input.startedAt) {
    log({ campaignId: input.campaignId, latencyMs: Date.now() - input.startedAt, success: true });
  }

  // Persist result for async polling — non-fatal if it fails
  if (TURN_RESULTS_TABLE && input.correlationId) {
    await ddb.send(new UpdateCommand({
      TableName: TURN_RESULTS_TABLE,
      Key: { turnId: input.correlationId },
      UpdateExpression: "SET #s = :s, #r = :r",
      ExpressionAttributeNames: { "#s": "status", "#r": "result" },
      ExpressionAttributeValues: { ":s": "complete", ":r": result },
    })).catch((e) => console.error("Failed to write turn result:", e));
  }

  return result;
};
