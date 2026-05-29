import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";

const cwl = new CloudWatchLogsClient({});

const LOG_GROUPS = [
  "/aws/lambda/neon-scratch-dungeon-controller",
  "/aws/lambda/neon-scratch-execute-tool",
  "/aws/lambda/neon-scratch-invoke-dungeon-master",
];

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

interface ProxyEvent {
  queryStringParameters?: Record<string, string> | null;
}

export const handler = async (event: ProxyEvent) => {
  const campaignId = event.queryStringParameters?.campaignId;
  if (!campaignId) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: "campaignId required" }) };
  }

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - 7200; // last 2 hours

  const queryString = `
    fields @timestamp, campaignId, latencyMs, toolName, total as diceResult, inputTokens, outputTokens, success, retryCount, @message
    | filter campaignId = "${campaignId.replace(/[^a-zA-Z0-9\-]/g, "")}"
    | sort @timestamp asc
    | limit 100
  `;

  const startResp = await cwl.send(new StartQueryCommand({
    logGroupNames: LOG_GROUPS,
    startTime,
    endTime,
    queryString,
  }));

  const queryId = startResp.queryId!;

  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 800));
    const pollResp = await cwl.send(new GetQueryResultsCommand({ queryId }));
    if (pollResp.status === "Complete") {
      const rows = (pollResp.results ?? []).map((row) => {
        const m: Record<string, string> = {};
        for (const f of row) if (f.field && f.value !== undefined) m[f.field] = f.value;
        return m;
      });
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ rows }) };
    }
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ rows: [] }) };
};
