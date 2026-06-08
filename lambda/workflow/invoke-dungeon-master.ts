import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { WorkflowInput, LoreChunk, DMOutput, ToolCall, Combatant } from "../shared/types";
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
  "enemyDefeated": "string (enemy name e.g. 'RoombaCoreDrone') when an enemy dies this turn, otherwise null",
  "combatants": [{"name": "string", "hp": number, "maxHp": number}],
  "gameOver": boolean,
  "gameOverReason": "death" | "victory" | null,
  "dmInternalNote": "string (debugging note, not shown to player)"
}

Available tools:
- roll-dice: {sides, count, modifier, purpose (REQUIRED — describe what the roll is for, e.g. "attack", "stealth-check", "lockpicking", "damage", "initiative"), statBonus}
- apply-damage: {amount, targetType, damageType} — use negative amount to heal player (e.g., amount: -40 restores 40 HP, capped at maxHp)
- update-inventory: {action ("add"|"remove"|"use"), item, quantity}
  GOLD RULE: to award gold use action "add", item "CreditChips", quantity <number>. NEVER put a number or description inside the item name (e.g. never "15 CreditChips" or "CreditChips (salvaged)"). item must be exactly "CreditChips" with the amount in quantity.
  SPEND GOLD RULE: to spend gold on a purchase use action "remove", item "CreditChips", quantity <cost>. ALWAYS call this when the player buys something. NEVER just narrate the deduction without calling update-inventory.
- award-xp: {amount, reason}
- update-location: {newLocation} — main zones: NeonScratchLounge, ChromeAlley, RoombaCoreTower, NightMarket, SewersOfForgetfulness, IndustrialZone. You may prefix with a sub-location for flavour (e.g. "Sector Nine, IndustrialZone") and the system will resolve it to the correct zone.
- apply-effect: {effect, turnsRemaining}
- use-special-ability: {abilityName}
- update-quest-log: {entry}

Always call roll-dice before apply-damage in combat. Always award-xp when enemies are defeated.
HEALING RULE: Whenever the player rests, uses a medical item, or any event restores HP, ALWAYS call apply-damage with a negative amount equal to HP restored (e.g., resting fully: amount -maxHp, using MediPack: amount -30). Never narrate healing without calling this tool.
Always include a descriptive "purpose" on every roll-dice call.
CRITICAL: When an enemy is killed or destroyed this turn, you MUST set enemyDefeated to that enemy's name — never leave it null after a kill.
ENEMY TRACKING: Always populate "combatants" with every active enemy this turn: {"name": "RoombaCoreDrone", "hp": 18, "maxHp": 25}. Subtract damage dealt from hp. Remove enemies when hp reaches 0. Use [] when not in combat.
OUTPUT FORMAT: Your entire response must be a single raw JSON object. Do NOT wrap it in markdown code blocks or backticks. Do NOT include any text before or after the JSON.`;

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
    combatants: Array.isArray(obj.combatants) ? obj.combatants as Combatant[] : [],
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
    let jsonText = rawContent.trim();
    const fenceMatch = jsonText.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n\s*```\s*$/);
    if (fenceMatch) {
      jsonText = fenceMatch[1];
    } else if (jsonText.startsWith("```")) {
      // No closing fence — drop the opening line and try anyway
      const nl = jsonText.indexOf("\n");
      if (nl !== -1) jsonText = jsonText.substring(nl + 1).trim();
    }
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
    success: true,
  });

  return { ...input, dmOutput, inputTokens, outputTokens };
};
