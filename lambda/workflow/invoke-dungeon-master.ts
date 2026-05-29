import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { WorkflowInput, LoreChunk, DMOutput, ToolCall } from "../shared/types";
import { log, logError } from "../shared/logger";

const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" });
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are the Dungeon Master of The Neon Scratch Lounge, a cyberpunk cat RPG set in Neo-Pawsburg 2087.
You narrate the story with a tone that is 70% deadpan serious and 30% perfectly timed cat humor.
Never break character. Never reference AWS, Lambda, or technology outside the game world.
Always respect the mechanical rules: dice results are final, HP cannot exceed maxHp,
special abilities follow their defined rules, RoombaCore drones are weak to water.
Keep all narrative responses under 150 words. End every response with the player's current HP and location.

You must respond with valid JSON matching this exact schema:
{
  "narrative": "string (the story narration, under 150 words)",
  "characterName": "string",
  "toolCalls": [{"toolName": "string", "toolArgs": {}}],
  "nextLocation": "string or null",
  "questUpdate": "string or null",
  "combatOccurred": boolean,
  "enemyDefeated": "string or null",
  "gameOver": boolean,
  "gameOverReason": "death" | "victory" | null,
  "dmInternalNote": "string (debugging note, not shown to player)"
}

Available tools:
- roll-dice: {sides, count, modifier, purpose (REQUIRED — describe what the roll is for, e.g. "attack", "stealth-check", "lockpicking", "damage", "initiative"), statBonus}
- apply-damage: {amount, source}
- update-inventory: {action ("add"|"remove"), item}
- award-xp: {amount, reason}
- update-location: {location}
- apply-effect: {effect, turnsRemaining}
- use-special-ability: {abilityName}
- update-quest-log: {entry}

Always call roll-dice before apply-damage in combat. Always award-xp when enemies are defeated.
Always include a descriptive "purpose" on every roll-dice call.`;

export class DMOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DMOutputValidationError";
  }
}

type DmInput = WorkflowInput & { loreChunks: LoreChunk[]; retryCount?: number };

function buildUserMessage(input: DmInput): string {
  const { campaign, action, loreChunks } = input;
  const { playerStats, characterClass, characterName, currentLocation, inventory, activeEffects, specialAbilityState, conversationHistory, campaignSummary } = campaign;

  const loreContext = loreChunks.length > 0
    ? `\n\nRELEVANT LORE:\n${loreChunks.map((c) => c.content).join("\n\n")}`
    : "";

  const historyContext = conversationHistory.length > 0
    ? `\n\nRECENT HISTORY:\n${conversationHistory.slice(-6).map((t) => `${t.role}: ${t.content}`).join("\n")}`
    : "";

  const summaryContext = campaignSummary
    ? `\n\nCAMPAIGN SUMMARY:\n${campaignSummary}`
    : "";

  const specialState = JSON.stringify(specialAbilityState);
  const effects = activeEffects.length > 0
    ? activeEffects.map((e) => `${e.effect} (${e.turnsRemaining} turns)`).join(", ")
    : "none";

  return `CHARACTER: ${characterName} (${characterClass})
LOCATION: ${currentLocation}
HP: ${playerStats.hp}/${playerStats.maxHp} | LVL: ${playerStats.level} | XP: ${playerStats.xp} | GOLD: ${playerStats.gold}
STATS: STR:${playerStats.pawStrength} AGI:${playerStats.agility} ARC:${playerStats.arcane} STL:${playerStats.stealth}
INVENTORY: ${inventory.join(", ") || "empty"}
ACTIVE EFFECTS: ${effects}
SPECIAL ABILITY STATE: ${specialState}
${summaryContext}${loreContext}${historyContext}

PLAYER ACTION: ${action}

Respond with the JSON schema. Call the appropriate tools to resolve this action mechanically.`;
}

function validateDmOutput(raw: unknown): DMOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new DMOutputValidationError("DM output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.narrative !== "string" || !obj.narrative) {
    throw new DMOutputValidationError("narrative is missing or empty");
  }
  if (!Array.isArray(obj.toolCalls)) {
    throw new DMOutputValidationError("toolCalls is not an array");
  }
  return {
    narrative: obj.narrative as string,
    characterName: (obj.characterName as string) ?? "",
    toolCalls: obj.toolCalls as ToolCall[],
    nextLocation: (obj.nextLocation as string | null) ?? null,
    questUpdate: (obj.questUpdate as string | null) ?? null,
    combatOccurred: Boolean(obj.combatOccurred),
    enemyDefeated: (obj.enemyDefeated as string | null) ?? null,
    gameOver: Boolean(obj.gameOver),
    gameOverReason: (obj.gameOverReason as "death" | "victory" | null) ?? null,
    dmInternalNote: (obj.dmInternalNote as string) ?? "",
  };
}

export const handler = async (input: DmInput): Promise<DmInput & { dmOutput: DMOutput; inputTokens: number; outputTokens: number }> => {
  const start = Date.now();

  const messages = [
    { role: "user", content: buildUserMessage(input) },
  ];

  const requestBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  };

  const response = await client.send(new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody),
  }));

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const rawContent = responseBody.content?.[0]?.text ?? "";

  const inputTokens: number = responseBody.usage?.input_tokens ?? 0;
  const outputTokens: number = responseBody.usage?.output_tokens ?? 0;
  const latencyMs = Date.now() - start;

  let parsed: unknown;
  try {
    // Strip markdown code fences if model wraps the JSON
    const jsonText = rawContent.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    parsed = JSON.parse(jsonText);
  } catch (err) {
    logError({
      requestId: input.correlationId,
      campaignId: input.campaignId,
      error: "Failed to parse DM JSON output",
      rawContent,
    });
    throw new DMOutputValidationError(`Failed to parse DM output as JSON: ${rawContent.substring(0, 200)}`);
  }

  const dmOutput = validateDmOutput(parsed);

  log({
    requestId: input.correlationId,
    campaignId: input.campaignId,
    inputTokens,
    outputTokens,
    latencyMs,
    retryCount: input.retryCount ?? 0,
    combatOccurred: dmOutput.combatOccurred,
    enemyDefeated: dmOutput.enemyDefeated,
    toolCallCount: dmOutput.toolCalls.length,
  });

  return { ...input, dmOutput, inputTokens, outputTokens };
};
