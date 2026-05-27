import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TOOL_RESULTS_TABLE!;
const TTL_SECONDS = parseInt(process.env.TOOL_RESULT_TTL_SECONDS ?? "3600", 10);

export function makeIdempotencyKey(campaignId: string, turnId: string, toolName: string, purpose: string): string {
  return `${campaignId}:${turnId}:${toolName}:${purpose}`;
}

export async function getCachedResult<T>(key: string): Promise<T | null> {
  const resp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { idempotencyKey: key } }));
  if (!resp.Item) return null;
  if (resp.Item.ttl && resp.Item.ttl < Math.floor(Date.now() / 1000)) return null;
  return resp.Item.result as T;
}

export async function setCachedResult<T>(key: string, result: T): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { idempotencyKey: key, result, ttl } }));
}
