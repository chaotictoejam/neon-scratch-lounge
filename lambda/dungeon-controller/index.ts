import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { SFNClient, StartSyncExecutionCommand } from "@aws-sdk/client-sfn";
import { v4 as uuidv4 } from "uuid";
import {
  Campaign, CharacterClass, CLASS_STARTING_STATS, CHARACTER_NAMES,
  PlayerAction, FormattedResponse,
} from "../shared/types";
import { log, logError } from "../shared/logger";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const sfn = new SFNClient({});

const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const CAMPAIGN_TTL_DAYS = parseInt(process.env.CAMPAIGN_TTL_DAYS ?? "30", 10);

function pickName(characterClass: CharacterClass): string {
  const names = CHARACTER_NAMES[characterClass];
  // Deterministic selection based on class — same class always rotates through same pool
  const seed = characterClass.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return names[seed % names.length];
}

function makeDefaultSpecialAbilityState() {
  return { nineLivesUsed: false, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: false };
}

function makeTtl(): number {
  return Math.floor(Date.now() / 1000) + CAMPAIGN_TTL_DAYS * 86400;
}

interface ProxyEvent { body: string | null }
interface ProxyResult { statusCode: number; headers: Record<string, string>; body: string }

const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

function ok(body: unknown): ProxyResult {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}
function err(statusCode: number, message: string): ProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify({ message }) };
}

export const handler = async (event: ProxyEvent): Promise<ProxyResult> => {
  let playerAction: PlayerAction;
  try {
    playerAction = JSON.parse(event.body ?? "{}") as PlayerAction;
  } catch {
    return err(400, "Invalid JSON body");
  }

  const start = Date.now();
  const { playerId, action } = playerAction;
  let campaignId = playerAction.campaignId;
  const correlationId = uuidv4();

  let campaign: Campaign;

  if (!playerId) return err(400, "playerId is required");
  if (!action) return err(400, "action is required");

  if (action === "new-game") {
    if (!playerAction.characterClass) return err(400, "characterClass is required for new-game action");
    const characterClass = playerAction.characterClass as CharacterClass;
    campaignId = uuidv4();
    const characterName = pickName(characterClass);
    const stats = CLASS_STARTING_STATS[characterClass];

    campaign = {
      campaignId,
      playerId,
      characterClass,
      characterName,
      currentLocation: "NeonScratchLounge",
      playerStats: { ...stats },
      specialAbilityState: makeDefaultSpecialAbilityState(),
      inventory: [],
      activeEffects: [],
      conversationHistory: [],
      campaignSummary: "",
      turnsPlayed: 0,
      monstersDefeated: 0,
      creditChipsEarned: 0,
      questLog: [],
      nineLivesUsed: false,
      gameOver: false,
      ttl: makeTtl(),
    };

    await ddb.send(new PutCommand({ TableName: CAMPAIGNS_TABLE, Item: campaign }));
  } else {
    if (!campaignId) return err(400, "campaignId is required for existing campaigns");
    const result = await ddb.send(new GetCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
    if (!result.Item) return err(404, `Campaign ${campaignId} not found`);
    campaign = result.Item as Campaign;

    if (campaign.gameOver) return err(400, "This campaign has ended. Start a new game.");
  }

  // Build workflow input
  const workflowInput = {
    campaignId,
    playerId,
    action,
    campaign,
    correlationId,
  };

  // For Express workflows, start synchronous execution directly (faster than EventBridge roundtrip)
  // EventBridge is still published for audit trail
  await eb.send(new PutEventsCommand({
    Entries: [{
      Source: "neon-scratch-lounge",
      DetailType: "PlayerAction",
      Detail: JSON.stringify(workflowInput),
      EventBusName: EVENT_BUS_NAME,
    }],
  }));

  // Start Express Workflow synchronously for real-time response
  const sfnResult = await sfn.send(new StartSyncExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    input: JSON.stringify(workflowInput),
    name: `${campaignId}-${correlationId}`.substring(0, 80),
  }));

  const latencyMs = Date.now() - start;
  const success = sfnResult.status === "SUCCEEDED";
  const output: FormattedResponse = success
    ? JSON.parse(sfnResult.output ?? "{}")
    : {} as FormattedResponse;

  const toolCount = output.metrics?.toolCalls?.length ?? 0;
  const workflowPath = [
    "retrieve-lore",
    "invoke-dm",
    "validate-route",
    `execute-tools(${toolCount})`,
    "persist-campaign",
    "format-response",
    ...(output.gameOver ? ["[GAME_OVER]"] : []),
  ].join(" → ");

  // One structured log line per request — queryable in CloudWatch Logs Insights
  log({
    requestId: correlationId,
    toolName: "dungeon-controller",
    inputTokens: output.metrics?.inputTokens ?? 0,
    outputTokens: output.metrics?.outputTokens ?? 0,
    latencyMs,
    retryCount: output.retryCount ?? 0,
    workflowPath,
    success,
  });

  if (!success) {
    logError({
      requestId: correlationId,
      campaignId,
      error: sfnResult.error,
      cause: sfnResult.cause,
    });
    return err(502, `Workflow failed: ${sfnResult.error ?? "unknown"}`);
  }

  return ok(output);
};
