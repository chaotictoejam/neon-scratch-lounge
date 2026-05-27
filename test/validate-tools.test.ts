// Tests for tool validation and routing logic

import { ALLOWED_TOOLS, ToolCall } from "../lambda/shared/types";

function validateAndRoute(toolCalls: ToolCall[], campaignId: string, turnId: string): {
  validated: (ToolCall & { campaignId: string; turnId: string })[];
  rejected: string[];
} {
  const validated: (ToolCall & { campaignId: string; turnId: string })[] = [];
  const rejected: string[] = [];

  for (const toolCall of toolCalls) {
    if (!ALLOWED_TOOLS.includes(toolCall.toolName)) {
      rejected.push(toolCall.toolName);
      continue;
    }
    validated.push({ ...toolCall, campaignId, turnId });
  }

  return { validated, rejected };
}

describe("Tool validation", () => {
  test("all ALLOWED_TOOLS pass through", () => {
    const toolCalls: ToolCall[] = ALLOWED_TOOLS.map((toolName) => ({
      toolName,
      toolArgs: {},
    }));
    const { validated, rejected } = validateAndRoute(toolCalls, "camp-1", "1");
    expect(validated).toHaveLength(ALLOWED_TOOLS.length);
    expect(rejected).toHaveLength(0);
  });

  test("unknown tool names are filtered", () => {
    const toolCalls: ToolCall[] = [
      { toolName: "roll-dice", toolArgs: {} },
      { toolName: "summon-elder-vacuum", toolArgs: {} },
      { toolName: "apply-damage", toolArgs: {} },
      { toolName: "hack-the-mainframe", toolArgs: {} },
    ];
    const { validated, rejected } = validateAndRoute(toolCalls, "camp-1", "1");
    expect(validated).toHaveLength(2);
    expect(rejected).toContain("summon-elder-vacuum");
    expect(rejected).toContain("hack-the-mainframe");
  });

  test("empty toolCalls array is handled gracefully", () => {
    const { validated, rejected } = validateAndRoute([], "camp-1", "1");
    expect(validated).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  test("all unknown tools produces empty validated list", () => {
    const toolCalls: ToolCall[] = [
      { toolName: "delete-city", toolArgs: {} },
      { toolName: "spawn-ceo-roomba", toolArgs: {} },
    ];
    const { validated, rejected } = validateAndRoute(toolCalls, "camp-1", "1");
    expect(validated).toHaveLength(0);
    expect(rejected).toHaveLength(2);
  });

  test("validated tool calls include campaignId and turnId", () => {
    const toolCalls: ToolCall[] = [{ toolName: "roll-dice", toolArgs: { sides: 20 } }];
    const { validated } = validateAndRoute(toolCalls, "my-campaign", "42");
    expect(validated[0].campaignId).toBe("my-campaign");
    expect(validated[0].turnId).toBe("42");
    expect(validated[0].toolArgs).toEqual({ sides: 20 });
  });

  test("ALLOWED_TOOLS contains exactly the expected 8 tools", () => {
    expect(ALLOWED_TOOLS).toHaveLength(8);
    expect(ALLOWED_TOOLS).toContain("roll-dice");
    expect(ALLOWED_TOOLS).toContain("apply-damage");
    expect(ALLOWED_TOOLS).toContain("update-inventory");
    expect(ALLOWED_TOOLS).toContain("award-xp");
    expect(ALLOWED_TOOLS).toContain("update-location");
    expect(ALLOWED_TOOLS).toContain("apply-effect");
    expect(ALLOWED_TOOLS).toContain("use-special-ability");
    expect(ALLOWED_TOOLS).toContain("update-quest-log");
  });
});
