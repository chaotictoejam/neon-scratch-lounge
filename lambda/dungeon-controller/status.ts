import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TURN_RESULTS_TABLE = process.env.TURN_RESULTS_TABLE!;
const TURN_TIMEOUT_MS = 90_000;

const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

interface ProxyEvent {
  queryStringParameters?: Record<string, string> | null;
}

export const handler = async (event: ProxyEvent) => {
  const turnId = event.queryStringParameters?.turnId;
  if (!turnId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "turnId required" }) };
  }

  const { Item: item } = await ddb.send(new GetCommand({
    TableName: TURN_RESULTS_TABLE,
    Key: { turnId },
  }));

  if (!item) {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ status: "not_found" }) };
  }

  if (item.status === "complete") {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: "complete", result: item.result }) };
  }

  if (item.status === "error") {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: "error", message: item.errorMessage }) };
  }

  if (Date.now() - item.startedAt > TURN_TIMEOUT_MS) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: "error", message: "Turn timed out" }) };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: "running" }) };
};
