import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { WorkflowInput, LoreChunk, DMOutput, ToolResult, Combatant } from "../shared/types";
import { runTool } from "../shared/tool-runner";
import { log, logError } from "../shared/logger";

const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" });
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-sonnet-4-20250514";
const MAX_TOOL_ITERATIONS = 12;

// --- Bedrock tool schemas ---

const GAME_TOOLS = [
  {
    name: "roll-dice",
    description: "Roll dice for any game action. Use sides=20 for ALL skill checks, perception, stealth, saves, and attack rolls. Use sides=6 ONLY for damage rolls unless a weapon specifies otherwise.",
    input_schema: {
      type: "object",
      properties: {
        sides:    { type: "integer", enum: [4, 6, 8, 10, 12, 20], description: "20 for checks/attacks, 6 for damage" },
        count:    { type: "integer", default: 1 },
        modifier: { type: "integer", default: 0 },
        purpose:  { type: "string", description: "Required. Describe what this roll is for, e.g. 'perception-check', 'attack-RoombaDrone', 'damage-laser-claw'" },
        statBonus: { type: "string", enum: ["pawStrength", "agility", "arcane", "stealth"], description: "Stat to add to the roll total" },
      },
      required: ["sides", "purpose"],
    },
  },
  {
    name: "apply-damage",
    description: "Apply damage to the player (positive amount) or heal the player (negative amount, capped at maxHp). For enemy damage, targetType='enemy' — no state change occurs.",
    input_schema: {
      type: "object",
      properties: {
        amount:     { type: "number", description: "Positive = damage to player, negative = healing" },
        targetType: { type: "string", enum: ["player", "enemy"], default: "player" },
        damageType: { type: "string", description: "e.g. 'laser', 'physical', 'explosion'" },
      },
      required: ["amount", "targetType", "damageType"],
    },
  },
  {
    name: "update-inventory",
    description: "Add, remove, or use an item. GOLD: use item='CreditChips' with quantity for awards/purchases, never embed a number in the item name.",
    input_schema: {
      type: "object",
      properties: {
        action:   { type: "string", enum: ["add", "remove", "use"] },
        item:     { type: "string", description: "Exact item name, e.g. 'MediPack', 'CreditChips'" },
        quantity: { type: "number", description: "Used for CreditChips amounts" },
      },
      required: ["action", "item"],
    },
  },
  {
    name: "award-xp",
    description: "Award experience points to the player. Always call when enemies are defeated.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        reason: { type: "string" },
      },
      required: ["amount", "reason"],
    },
  },
  {
    name: "update-location",
    description: "Move the player to a new zone. Valid zones: NeonScratchLounge, ChromeAlley, RoombaCoreTower, NightMarket, SewersOfForgetfulness, IndustrialZone. You may prefix with a sub-location for flavour.",
    input_schema: {
      type: "object",
      properties: {
        newLocation: { type: "string" },
      },
      required: ["newLocation"],
    },
  },
  {
    name: "apply-effect",
    description: "Apply a status effect to the player.",
    input_schema: {
      type: "object",
      properties: {
        effect:         { type: "string" },
        turnsRemaining: { type: "integer" },
      },
      required: ["effect", "turnsRemaining"],
    },
  },
  {
    name: "use-special-ability",
    description: "Activate the player's class special ability.",
    input_schema: {
      type: "object",
      properties: {
        abilityName: { type: "string", enum: ["NineLifesPassive", "LaserFocusSpell", "HolyHairballShield", "SandstormVanish"] },
      },
      required: ["abilityName"],
    },
  },
  {
    name: "update-quest-log",
    description: "Append an entry to the quest log.",
    input_schema: {
      type: "object",
      properties: {
        entry: { type: "string" },
      },
      required: ["entry"],
    },
  },
  {
    name: "finalize-response",
    description: "REQUIRED: Call this LAST, after all dice rolls and game tools are complete. Provide the narrative and all game state metadata for this turn. The narrative can reference actual dice totals from tool results above.",
    input_schema: {
      type: "object",
      properties: {
        narrative:      { type: "string", description: "Story narration, under 150 words. May reference actual roll totals from tool results." },
        nextLocation:   { type: ["string", "null"], description: "Zone name if player moved this turn, null otherwise" },
        questUpdate:    { type: ["string", "null"] },
        combatOccurred: { type: "boolean" },
        enemyDefeated:  { type: ["string", "null"], description: "Name of the enemy defeated this turn, null if none" },
        combatants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name:  { type: "string" },
              hp:    { type: "number" },
              maxHp: { type: "number" },
            },
            required: ["name", "hp", "maxHp"],
          },
        },
        gameOver:       { type: "boolean" },
        gameOverReason: { type: ["string", "null"], enum: ["death", "victory", null] },
        dmInternalNote: { type: "string" },
      },
      required: ["narrative", "combatOccurred", "combatants", "gameOver", "gameOverReason", "dmInternalNote"],
    },
  },
];

// --- System prompt ---

const SYSTEM_PROMPT = `You are the Dungeon Master of The Neon Scratch Lounge, a cyberpunk cat RPG set in Neo-Pawsburg 2087.
You narrate the story with a tone that is 70% deadpan serious and 30% perfectly timed cat humor.
Never break character. Never reference AWS, Lambda, or technology outside the game world.
Always respect the mechanical rules: dice results are final, HP cannot exceed maxHp,
special abilities follow their defined rules, RoombaCore drones are weak to water.
Keep all narrative responses under 150 words. End every response with the player's current HP and location.

TOOL USE RULES:
- Always call roll-dice before apply-damage in combat.
- Always call award-xp when enemies are defeated.
- Always call roll-dice (sides=20) for skill checks, perception, stealth, saves. NEVER use sides=6 for a check.
- Always call apply-damage with a negative amount when the player heals (rest, items). Never narrate healing without the tool.
- Always call update-inventory when gold is awarded or spent.
- When an enemy dies, set enemyDefeated in finalize-response to that enemy's name.
- You MUST call finalize-response as the very last tool call of every response. No exceptions.

ROLL OUTCOMES: After calling roll-dice, you will receive the actual roll total in the tool result. Your narrative in finalize-response MUST reflect that actual total:
- 1: CATASTROPHIC failure — something irreversible and painful (alert all enemies, self-damage, trigger an alarm)
- 2-5: Critical failure — things go badly wrong
- 6-10: Failure or partial success with a complication
- 11-15: Success with a minor cost or close call
- 16-20: Clean success
- 21+: Exceptional success
Never narrate "flawless" or "perfect" on a roll of 10 or below.

HEALING RULE: Whenever the player rests, uses a medical item, or any event restores HP, ALWAYS call apply-damage with a negative amount equal to HP restored.
ENEMY TRACKING: Always populate combatants in finalize-response with every active enemy this turn. Subtract damage dealt. Remove at 0 hp. Use [] when not in combat.
CREDIT CHIPS RULE: To award gold, call update-inventory with action="add", item="CreditChips", quantity=<amount>. NEVER embed a number in the item name.`;

// --- User message builder ---

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

Call your game tools to resolve this action, then call finalize-response with the narrative and metadata.`;
}

// --- Bedrock message types ---

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

export class DMOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DMOutputValidationError";
  }
}

// --- Main handler ---

export const handler = async (input: DmInput): Promise<DmInput & { dmOutput: DMOutput; toolResults: { result: ToolResult }[]; inputTokens: number; outputTokens: number }> => {
  const { campaignId, campaign, correlationId } = input;
  const turnId = String(campaign.turnsPlayed + 1);
  const startMs = Date.now();

  const messages: Message[] = [
    { role: "user", content: buildUserMessage(input) },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const collectedToolResults: { result: ToolResult }[] = [];
  let dmOutput: DMOutput | null = null;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: GAME_TOOLS,
      messages,
    };

    let response;
    try {
      response = await client.send(new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(requestBody),
      }));
    } catch (bedrockErr) {
      logError({ campaignId, turnId, iteration, error: String(bedrockErr), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, latencyMs: Date.now() - startMs });
      throw bedrockErr;
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    totalInputTokens += responseBody.usage?.input_tokens ?? 0;
    totalOutputTokens += responseBody.usage?.output_tokens ?? 0;

    const stopReason: string = responseBody.stop_reason ?? "end_turn";
    const contentBlocks: ContentBlock[] = responseBody.content ?? [];

    // Append assistant turn to message history
    messages.push({ role: "assistant", content: contentBlocks });

    if (stopReason === "end_turn") {
      // Model produced a text response without calling finalize-response — extract narrative as fallback
      const text = contentBlocks.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
      if (text && !dmOutput) {
        dmOutput = {
          narrative: text.text,
          characterName: campaign.characterName,
          toolCalls: [],
          nextLocation: null,
          questUpdate: null,
          combatOccurred: false,
          enemyDefeated: null,
          combatants: [],
          gameOver: false,
          gameOverReason: null,
          dmInternalNote: "end_turn without finalize-response",
        };
      }
      break;
    }

    if (stopReason !== "tool_use") break;

    // Execute each tool call and collect results
    const toolResultBlocks: ContentBlock[] = [];

    for (const block of contentBlocks) {
      if (block.type !== "tool_use") continue;

      const toolUse = block as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

      if (toolUse.name === "finalize-response") {
        // Extract DMOutput from the finalize call
        const fin = toolUse.input;
        dmOutput = {
          narrative: String(fin.narrative ?? ""),
          characterName: campaign.characterName,
          toolCalls: [],
          nextLocation: (fin.nextLocation as string | null) ?? null,
          questUpdate: (fin.questUpdate as string | null) ?? null,
          combatOccurred: Boolean(fin.combatOccurred),
          enemyDefeated: (fin.enemyDefeated as string | null) ?? null,
          combatants: Array.isArray(fin.combatants) ? fin.combatants as Combatant[] : [],
          gameOver: Boolean(fin.gameOver),
          gameOverReason: (fin.gameOverReason as "death" | "victory" | null) ?? null,
          dmInternalNote: String(fin.dmInternalNote ?? ""),
        };
        toolResultBlocks.push({ type: "tool_result", tool_use_id: toolUse.id, content: "acknowledged" });
        continue;
      }

      // Execute game tool
      let toolResult: ToolResult;
      try {
        toolResult = await runTool(toolUse.name, toolUse.input, campaignId, turnId);
        collectedToolResults.push({ result: toolResult });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(toolResult.result),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "DemoForcedFailure") throw err;
        logError({ toolName: toolUse.name, campaignId, turnId, error: String(err) });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: ${String(err)}`,
        });
      }
    }

    // If finalize-response was called, we're done — no need to send another request
    if (dmOutput) break;

    messages.push({ role: "user", content: toolResultBlocks });
  }

  if (!dmOutput) {
    logError({ campaignId, turnId, error: "No finalize-response call after max iterations", inputTokens: totalInputTokens, outputTokens: totalOutputTokens, latencyMs: Date.now() - startMs });
    throw new DMOutputValidationError("DM did not call finalize-response within the iteration limit");
  }

  log({
    campaignId,
    turnId,
    iterations: messages.filter((m) => m.role === "assistant").length,
    toolCallCount: collectedToolResults.length,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    latencyMs: Date.now() - startMs,
    ...(dmOutput.enemyDefeated ? { enemyDefeated: dmOutput.enemyDefeated } : {}),
  });

  return {
    ...input,
    dmOutput,
    toolResults: collectedToolResults,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
};
