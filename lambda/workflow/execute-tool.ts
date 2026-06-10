import { ToolCall, ToolResult } from "../shared/types";
import { runTool } from "../shared/tool-runner";
import { makeIdempotencyKey } from "../shared/idempotency";
import { log } from "../shared/logger";

type ToolInput = ToolCall & { campaignId: string; turnId: string };

export const handler = async (input: ToolInput): Promise<{ result: ToolResult }> => {
  // DEMO-ONLY: force a failure to trigger the retry animation in the UI
  if (process.env.FORCE_TOOL_FAILURE === "true") {
    throw new Error("DemoForcedFailure: failure injection active");
  }

  const { campaignId, turnId, toolName, toolArgs } = input;

  log({ toolName, campaignId, turnId, source: "execute-tool-lambda" });

  const toolResult = await runTool(toolName, toolArgs, campaignId, turnId);
  return { result: toolResult };
};
