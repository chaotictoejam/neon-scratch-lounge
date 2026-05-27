import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  ToolCall, ToolResult, Campaign, CharacterClass,
  DiceRollResult, DamageResult, InventoryResult, XpResult,
  LocationResult, EffectResult, SpecialAbilityResult, QuestLogResult,
  KNOWN_LOCATIONS,
} from "../shared/types";
import { getCachedResult, setCachedResult, makeIdempotencyKey } from "../shared/idempotency";
import { log, logError } from "../shared/logger";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE!;
const XP_PER_LEVEL = parseInt(process.env.XP_PER_LEVEL ?? "100", 10);

type ToolInput = ToolCall & { campaignId: string; turnId: string };

// Dice roller — crypto-quality randomness not needed for a cat RPG
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

async function getCampaign(campaignId: string): Promise<Campaign> {
  const result = await ddb.send(new GetCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
  if (!result.Item) throw new Error(`Campaign ${campaignId} not found`);
  return result.Item as Campaign;
}

async function patchCampaign(campaignId: string, updateExpression: string, expressionAttributeValues: Record<string, unknown>, expressionAttributeNames?: Record<string, string>): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: CAMPAIGNS_TABLE,
    Key: { campaignId },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
  }));
}

// --- Tool implementations ---

async function rollDice(args: Record<string, unknown>, campaign: Campaign): Promise<DiceRollResult> {
  const sides = Number(args.sides ?? 20);
  const count = Number(args.count ?? 1);
  const modifier = Number(args.modifier ?? 0);
  const purpose = String(args.purpose ?? "unknown");
  const statBonus = args.statBonus as keyof Campaign["playerStats"] | undefined;

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides));

  const stat = statBonus ? (campaign.playerStats[statBonus] as number ?? 0) : 0;
  const total = rolls.reduce((a, b) => a + b, 0) + modifier + stat;

  log({ toolName: "roll-dice", sides, count, modifier, statBonus: stat, rolls, total, purpose });
  return { rolls, modifier, statBonus: stat, total, purpose };
}

async function applyDamage(args: Record<string, unknown>, campaign: Campaign): Promise<DamageResult> {
  const targetType = String(args.targetType ?? "player");
  const rawDamage = Number(args.damage ?? 0);
  const damageType = String(args.damageType ?? "unknown");

  if (targetType !== "player") {
    // Enemy damage is tracked narratively, not in campaign state
    return { previousHp: 0, newHp: 0, damageBlocked: 0, nineLivesTrigger: false, isDead: false };
  }

  let damageBlocked = 0;
  let actualDamage = rawDamage;

  // MaineCoonPaladin HolyHairballShield
  if (campaign.characterClass === "MaineCoonPaladin" && !campaign.specialAbilityState.shieldUsedThisEncounter) {
    if (actualDamage > 0) {
      damageBlocked = Math.min(15, actualDamage);
      actualDamage -= damageBlocked;
      // Mark shield as used
      await patchCampaign(
        campaign.campaignId,
        "SET specialAbilityState.shieldUsedThisEncounter = :used",
        { ":used": true }
      );
      campaign.specialAbilityState.shieldUsedThisEncounter = true;
    }
  }

  // NeonScratchCoat laser resistance
  if (damageType === "laser" && campaign.inventory.includes("NeonScratchCoat")) {
    const reduction = Math.min(3, actualDamage);
    actualDamage -= reduction;
    damageBlocked += reduction;
  }

  const previousHp = campaign.playerStats.hp;
  let newHp = Math.max(0, previousHp - actualDamage);
  let nineLivesTrigger = false;

  // TabbyWarrior NineLifesPassive
  if (newHp <= 0 && campaign.characterClass === "TabbyWarrior" && !campaign.specialAbilityState.nineLivesUsed) {
    newHp = 1;
    nineLivesTrigger = true;
    await patchCampaign(
      campaign.campaignId,
      "SET specialAbilityState.nineLivesUsed = :used, nineLivesUsed = :used",
      { ":used": true }
    );
  }

  const isDead = newHp <= 0;

  await patchCampaign(
    campaign.campaignId,
    "SET playerStats.hp = :hp",
    { ":hp": newHp }
  );

  log({ toolName: "apply-damage", targetType, rawDamage, actualDamage, damageBlocked, damageType, previousHp, newHp, nineLivesTrigger, isDead });
  return { previousHp, newHp, damageBlocked, nineLivesTrigger, isDead };
}

async function updateInventory(args: Record<string, unknown>, campaign: Campaign): Promise<InventoryResult> {
  const action = String(args.action ?? "add");
  const item = String(args.item ?? "");
  let inventory = [...campaign.inventory];
  let gold = campaign.playerStats.gold;
  let effectApplied: string | undefined;

  if (action === "add") {
    if (item === "CreditChips") {
      const amount = Number(args.quantity ?? 10);
      gold += amount;
      await patchCampaign(campaign.campaignId, "SET playerStats.gold = :g", { ":g": gold });
    } else {
      inventory.push(item);
      await patchCampaign(campaign.campaignId, "SET inventory = :inv", { ":inv": inventory });
    }
  } else if (action === "remove") {
    inventory = inventory.filter((i) => i !== item);
    await patchCampaign(campaign.campaignId, "SET inventory = :inv", { ":inv": inventory });
  } else if (action === "use") {
    const ITEM_EFFECTS: Record<string, string> = {
      MysteryCanOfTuna: "Restore 40hp",
      AncientCatnip: "Roll 1d6: 1-2 restore 50hp, 3-4 deal 50 damage to random enemy, 5-6 both",
      LaserPointerMk2: "Stun enemy for 1 turn",
    };
    effectApplied = ITEM_EFFECTS[item] ?? "Unknown effect";

    if (item === "MysteryCanOfTuna") {
      const newHp = Math.min(campaign.playerStats.maxHp, campaign.playerStats.hp + 40);
      await patchCampaign(campaign.campaignId, "SET playerStats.hp = :hp", { ":hp": newHp });
    }

    inventory = inventory.filter((i) => i !== item);
    await patchCampaign(campaign.campaignId, "SET inventory = :inv", { ":inv": inventory });
  }

  return { inventory, gold, effectApplied };
}

async function awardXp(args: Record<string, unknown>, campaign: Campaign): Promise<XpResult> {
  const xp = Number(args.xp ?? 0);
  const previousLevel = campaign.playerStats.level;
  const newXp = campaign.playerStats.xp + xp;
  const newLevel = Math.floor(newXp / XP_PER_LEVEL) + 1;
  const leveledUp = newLevel > previousLevel;

  let statImproved: string | undefined;
  let maxHpIncrease = 0;

  if (leveledUp) {
    const stats = ["pawStrength", "agility", "arcane", "stealth"] as const;
    statImproved = stats[Math.floor(Math.random() * stats.length)];
    maxHpIncrease = 10;
  }

  const updateParts: string[] = ["SET playerStats.xp = :xp, playerStats.#level = :level, playerStats.maxHp = :maxHp"];
  const values: Record<string, unknown> = {
    ":xp": newXp,
    ":level": newLevel,
    ":maxHp": campaign.playerStats.maxHp + maxHpIncrease,
  };

  if (statImproved) {
    updateParts.push(`playerStats.${statImproved} = :statVal`);
    values[":statVal"] = (campaign.playerStats[statImproved as keyof typeof campaign.playerStats] as number) + 1;
  }

  await patchCampaign(
    campaign.campaignId,
    updateParts.join(", "),
    values,
    { "#level": "level" }
  );

  return { previousLevel, newLevel, newXp, leveledUp, statImproved };
}

async function updateLocation(args: Record<string, unknown>, campaign: Campaign): Promise<LocationResult> {
  const newLocation = String(args.newLocation ?? "");
  if (!KNOWN_LOCATIONS.includes(newLocation)) {
    throw new Error(`Unknown location: ${newLocation}. Valid locations: ${KNOWN_LOCATIONS.join(", ")}`);
  }

  const previousLocation = campaign.currentLocation;
  await patchCampaign(campaign.campaignId, "SET currentLocation = :loc", { ":loc": newLocation });

  const descriptions: Record<string, string> = {
    NeonScratchLounge: "The resistance HQ. Smells of tuna and old leather. Safe.",
    ChromeAlley: "Rain-slicked alleys, neon graffiti, RoombaCore patrols.",
    RoombaCoreTower: "The megacorp HQ. 40 floors of brushed steel. Heavily guarded.",
    NightMarket: "Underground market. Stolen tech and black-market tuna.",
    SewersOfForgetfulness: "Ancient sewers. Smells terrible. Home to things that rejected society.",
  };

  return { previousLocation, newLocation, locationDescription: descriptions[newLocation] ?? newLocation };
}

async function applyEffect(args: Record<string, unknown>, campaign: Campaign): Promise<EffectResult> {
  const effect = String(args.effect ?? "");
  const duration = Number(args.duration ?? 1);

  const activeEffects = campaign.activeEffects
    .map((e) => ({ ...e, turnsRemaining: e.turnsRemaining - 1 }))
    .filter((e) => e.turnsRemaining > 0);

  activeEffects.push({ effect, turnsRemaining: duration });
  await patchCampaign(campaign.campaignId, "SET activeEffects = :fx", { ":fx": activeEffects });

  return { activeEffects };
}

async function useSpecialAbility(args: Record<string, unknown>, campaign: Campaign): Promise<SpecialAbilityResult> {
  const ability = String(args.ability ?? "");

  const classAbilities: Record<CharacterClass, string> = {
    TabbyWarrior: "NineLifesPassive",
    SiameseMage: "LaserFocusSpell",
    MaineCoonPaladin: "HolyHairballShield",
    SphinxRogue: "SandstormVanish",
  };

  if (classAbilities[campaign.characterClass] !== ability) {
    throw new Error(`Ability ${ability} does not match class ${campaign.characterClass}`);
  }

  let mechanicalEffect = "";
  let cooldownSet: number | undefined;

  if (ability === "SandstormVanish") {
    if (campaign.specialAbilityState.vanishCooldownTurnsLeft > 0) {
      throw new Error(`SandstormVanish on cooldown: ${campaign.specialAbilityState.vanishCooldownTurnsLeft} turns remaining`);
    }
    cooldownSet = 3;
    await patchCampaign(
      campaign.campaignId,
      "SET specialAbilityState.vanishCooldownTurnsLeft = :cd",
      { ":cd": cooldownSet }
    );
    mechanicalEffect = "All enemy attacks miss this turn. 3-turn cooldown set.";
  } else if (ability === "LaserFocusSpell") {
    const newHp = campaign.playerStats.hp - 10;
    if (newHp <= 0) throw new Error("Not enough HP to use LaserFocusSpell (costs 10hp)");
    await patchCampaign(campaign.campaignId, "SET playerStats.hp = :hp", { ":hp": newHp });
    mechanicalEffect = `Spent 10hp. Next attack deals 3x arcane (${campaign.playerStats.arcane * 3}) damage.`;
  } else if (ability === "HolyHairballShield") {
    mechanicalEffect = "Shield active. Will block up to 15 damage on next hit this encounter.";
  } else if (ability === "NineLifesPassive") {
    mechanicalEffect = "Passive — triggers automatically on death. Cannot be manually activated.";
  }

  return { abilityUsed: ability, mechanicalEffect, cooldownSet };
}

async function updateQuestLog(args: Record<string, unknown>, campaign: Campaign): Promise<QuestLogResult> {
  const entry = String(args.entry ?? "");
  const timestamp = new Date().toISOString();
  const questLog = [...campaign.questLog, `[${timestamp}] ${entry}`];
  await patchCampaign(campaign.campaignId, "SET questLog = :ql", { ":ql": questLog });
  return { questLog };
}

// Main handler
export const handler = async (input: ToolInput): Promise<{ result: ToolResult }> => {
  // DEMO-ONLY: force a failure to trigger the retry animation in the UI
  if (process.env.FORCE_TOOL_FAILURE === "true") {
    throw new Error("DemoForcedFailure: failure injection active");
  }

  const { campaignId, turnId, toolName, toolArgs } = input;
  const idempotencyKey = makeIdempotencyKey(campaignId, turnId, toolName, String(toolArgs.purpose ?? toolName));

  const cached = await getCachedResult<ToolResult>(idempotencyKey);
  if (cached) {
    log({ toolName, campaignId, turnId, idempotencyHit: true });
    return { result: cached };
  }

  const campaign = await getCampaign(campaignId);
  let result: ToolResult["result"];

  try {
    switch (toolName) {
      case "roll-dice":
        result = await rollDice(toolArgs, campaign);
        break;
      case "apply-damage":
        result = await applyDamage(toolArgs, campaign);
        break;
      case "update-inventory":
        result = await updateInventory(toolArgs, campaign);
        break;
      case "award-xp":
        result = await awardXp(toolArgs, campaign);
        break;
      case "update-location":
        result = await updateLocation(toolArgs, campaign);
        break;
      case "apply-effect":
        result = await applyEffect(toolArgs, campaign);
        break;
      case "use-special-ability":
        result = await useSpecialAbility(toolArgs, campaign);
        break;
      case "update-quest-log":
        result = await updateQuestLog(toolArgs, campaign);
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    logError({ toolName, campaignId, turnId, error: String(err) });
    throw err;
  }

  const toolResult: ToolResult = { toolName, result };
  await setCachedResult(idempotencyKey, toolResult);

  log({ toolName, campaignId, turnId, idempotencyHit: false });
  return { result: toolResult };
};
