import { WorkflowInput, DMOutput, ToolCall, ALLOWED_TOOLS } from "../shared/types";
import { log, logWarn } from "../shared/logger";

type ValidateInput = WorkflowInput & { loreChunks: unknown[]; dmOutput: DMOutput };

export const handler = async (
  input: ValidateInput
): Promise<ValidateInput & { validatedToolCalls: (ToolCall & { campaignId: string; turnId: string })[] }> => {
  const { dmOutput, campaignId, correlationId, campaign } = input;
  const turnId = String(campaign.turnsPlayed + 1);

  const validatedToolCalls: (ToolCall & { campaignId: string; turnId: string })[] = [];
  const rejectedTools: string[] = [];

  for (const toolCall of dmOutput.toolCalls) {
    if (!ALLOWED_TOOLS.includes(toolCall.toolName)) {
      logWarn({
        requestId: correlationId,
        campaignId,
        message: "Unknown tool filtered",
        toolName: toolCall.toolName,
        allowedTools: ALLOWED_TOOLS,
      });
      rejectedTools.push(toolCall.toolName);
      continue;
    }
    validatedToolCalls.push({ ...toolCall, campaignId, turnId });
  }

  log({
    requestId: correlationId,
    campaignId,
    validatedToolCount: validatedToolCalls.length,
    rejectedToolCount: rejectedTools.length,
    rejectedTools,
  });

  return { ...input, validatedToolCalls };
};
