import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  Campaign, CharacterClass,
  DiceRollResult, DamageResult, InventoryResult, XpResult,
  LocationResult, EffectResult, SpecialAbilityResult, QuestLogResult,
  ToolResult, KNOWN_LOCATIONS,
} from "./types";
import { getCachedResult, setCachedResult, makeIdempotencyKey } from "./idempotency";
import { log, logError } from "./logger";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE!;
const XP_PER_LEVEL = parseInt(process.env.XP_PER_LEVEL ?? "100", 10);

// Dice roller — crypto-quality randomness not needed for a cat RPG
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const result = await ddb.send(new GetCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
  if (!result.Item) throw new Error(`Campaign ${campaignId} not found`);
  return result.Item as Campaign;
}

export async function patchCampaign(campaignId: string, updateExpression: string, expressionAttributeValues: Record<string, unknown>, expressionAttributeNames?: Record<string, string>): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: CAMPAIGNS_TABLE,
    Key: { campaignId },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
  }));
}

export async function toolRollDice(args: Record<string, unknown>, campaign: Campaign): Promise<DiceRollResult> {
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

export async function toolApplyDamage(args: Record<string, unknown>, campaign: Campaign): Promise<DamageResult> {
  const targetType = String(args.targetType ?? "player");
  const rawDamage = Number(args.amount ?? args.damage ?? 0);
  const damageType = String(args.damageType ?? "unknown");

  if (targetType !== "player") {
    return { previousHp: 0, newHp: 0, damageBlocked: 0, nineLivesTrigger: false, isDead: false };
  }

  const previousHp = campaign.playerStats.hp;

  if (rawDamage < 0) {
    const newHp = Math.min(campaign.playerStats.maxHp, previousHp + Math.abs(rawDamage));
    await patchCampaign(campaign.campaignId, "SET playerStats.hp = :hp", { ":hp": newHp });
    log({ toolName: "apply-damage", targetType, rawDamage, actualDamage: rawDamage, damageBlocked: 0, damageType, previousHp, newHp, nineLivesTrigger: false, isDead: false });
    return { previousHp, newHp, damageBlocked: 0, nineLivesTrigger: false, isDead: false };
  }

  let damageBlocked = 0;
  let actualDamage = rawDamage;

  // MaineCoonPaladin HolyHairballShield
  if (campaign.characterClass === "MaineCoonPaladin" && !campaign.specialAbilityState.shieldUsedThisEncounter) {
    if (actualDamage > 0) {
      damageBlocked = Math.min(15, actualDamage);
      actualDamage -= damageBlocked;
      await patchCampaign(campaign.campaignId, "SET specialAbilityState.shieldUsedThisEncounter = :used", { ":used": true });
      campaign.specialAbilityState.shieldUsedThisEncounter = true;
    }
  }

  // NeonScratchCoat laser resistance
  if (damageType === "laser" && campaign.inventory.includes("NeonScratchCoat")) {
    const reduction = Math.min(3, actualDamage);
    actualDamage -= reduction;
    damageBlocked += reduction;
  }

  let newHp = Math.max(0, previousHp - actualDamage);
  let nineLivesTrigger = false;

  // TabbyWarrior NineLifesPassive
  if (newHp <= 0 && campaign.characterClass === "TabbyWarrior" && !campaign.specialAbilityState.nineLivesUsed) {
    newHp = 1;
    nineLivesTrigger = true;
    await patchCampaign(campaign.campaignId, "SET specialAbilityState.nineLivesUsed = :used, nineLivesUsed = :used", { ":used": true });
  }

  const isDead = newHp <= 0;
  await patchCampaign(campaign.campaignId, "SET playerStats.hp = :hp", { ":hp": newHp });

  log({ toolName: "apply-damage", targetType, rawDamage, actualDamage, damageBlocked, damageType, previousHp, newHp, nineLivesTrigger, isDead });
  return { previousHp, newHp, damageBlocked, nineLivesTrigger, isDead };
}

export async function toolUpdateInventory(args: Record<string, unknown>, campaign: Campaign): Promise<InventoryResult> {
  const action = String(args.action ?? "add");
  const item = String(args.item ?? "");
  let inventory = [...campaign.inventory];
  let gold = campaign.playerStats.gold;
  let effectApplied: string | undefined;

  const creditChipMatch = item.match(/^(\d+)\s+creditchips?/i) ?? item.match(/creditchips?/i);
  const isCreditChips = !!creditChipMatch;

  if (action === "add") {
    if (isCreditChips) {
      const embeddedAmount = item.match(/^(\d+)/);
      const amount = embeddedAmount ? parseInt(embeddedAmount[1], 10) : Number(args.quantity ?? 10);
      gold += amount;
      await patchCampaign(campaign.campaignId, "SET playerStats.gold = :g", { ":g": gold });
    } else if (!inventory.includes(item)) {
      inventory.push(item);
      await patchCampaign(campaign.campaignId, "SET inventory = :inv", { ":inv": inventory });
    }
  } else if (action === "remove") {
    if (isCreditChips) {
      const embeddedAmount = item.match(/^(\d+)/);
      const amount = embeddedAmount ? parseInt(embeddedAmount[1], 10) : Number(args.quantity ?? 0);
      gold = Math.max(0, gold - amount);
      await patchCampaign(campaign.campaignId, "SET playerStats.gold = :g", { ":g": gold });
    } else {
      inventory = inventory.filter((i) => i !== item);
      await patchCampaign(campaign.campaignId, "SET inventory = :inv", { ":inv": inventory });
    }
  } else if (action === "use") {
    const ITEM_HP_RESTORE: Record<string, number> = {
      MysteryCanOfTuna: 40,
      MediPack: 30,
      AdvancedMedKit: 60,
      "Advanced Med-Kit": 60,
      StandardMedKit: 40,
      "Standard Med-Kit": 40,
    };
    const ITEM_EFFECTS: Record<string, string> = {
      AncientCatnip: "Roll 1d6: 1-2 restore 50hp, 3-4 deal 50 damage to random enemy, 5-6 both",
      LaserPointerMk2: "Stun enemy for 1 turn",
    };

    const restoreAmount = ITEM_HP_RESTORE[item] ?? (/med.?kit|medkit|medikit/i.test(item) ? 40 : 0);

    if (restoreAmount > 0) {
      const newHp = Math.min(campaign.playerStats.maxHp, campaign.playerStats.hp + restoreAmount);
      await patchCampaign(campaign.campaignId, "SET playerStats.hp = :hp", { ":hp": newHp });
      effectApplied = `Restored ${restoreAmount}hp`;
    } else {
      effectApplied = ITEM_EFFECTS[item] ?? "Unknown effect";
    }

    inventory = inventory.filter((i) => i !== item);
    await patchCampaign(campaign.campaignId, "SET inventory = :inv", { ":inv": inventory });
  }

  return { inventory, gold, effectApplied };
}

export async function toolAwardXp(args: Record<string, unknown>, campaign: Campaign): Promise<XpResult> {
  const xp = Number(args.amount ?? args.xp ?? 0);
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

  await patchCampaign(campaign.campaignId, updateParts.join(", "), values, { "#level": "level" });

  return { previousLevel, newLevel, newXp, leveledUp, statImproved };
}

function resolveLocation(input: string): string | null {
  if (KNOWN_LOCATIONS.includes(input)) return input;

  const norm = input.toLowerCase().replace(/[\s\-_,./]+/g, "");

  for (const loc of KNOWN_LOCATIONS) {
    if (norm === loc.toLowerCase()) return loc;
  }

  for (const loc of KNOWN_LOCATIONS) {
    if (norm.includes(loc.toLowerCase())) return loc;
  }

  const words = norm.split(/[^a-z]+/).filter((w) => w.length >= 5);
  for (const loc of KNOWN_LOCATIONS) {
    const locNorm = loc.toLowerCase();
    if (words.some((w) => locNorm.includes(w))) return loc;
  }

  return null;
}

export async function toolUpdateLocation(args: Record<string, unknown>, campaign: Campaign): Promise<LocationResult> {
  const raw = String(args.newLocation ?? args.location ?? "").trim();
  const newLocation = raw ? resolveLocation(raw) : null;

  if (!newLocation) {
    log({ toolName: "update-location", warning: `Unresolvable location ignored: "${raw}"`, campaignId: campaign.campaignId });
    return { previousLocation: campaign.currentLocation, newLocation: campaign.currentLocation, locationDescription: "No change" };
  }

  const previousLocation = campaign.currentLocation;
  await patchCampaign(campaign.campaignId, "SET currentLocation = :loc", { ":loc": newLocation });

  const descriptions: Record<string, string> = {
    NeonScratchLounge: "The resistance HQ. Smells of tuna and old leather. Safe.",
    ChromeAlley: "Rain-slicked alleys, neon graffiti, RoombaCore patrols.",
    RoombaCoreTower: "The megacorp HQ. 40 floors of brushed steel. Heavily guarded.",
    NightMarket: "Underground market. Stolen tech and black-market tuna.",
    SewersOfForgetfulness: "Ancient sewers. Smells terrible. Home to things that rejected society.",
    IndustrialZone: "Rusted warehouses and fabrication plants. Sector Nine gangs run protection here.",
  };

  return { previousLocation, newLocation, locationDescription: descriptions[newLocation] ?? newLocation };
}

export async function toolApplyEffect(args: Record<string, unknown>, campaign: Campaign): Promise<EffectResult> {
  const effect = String(args.effect ?? "");
  const duration = Number(args.turnsRemaining ?? args.duration ?? 1);

  const activeEffects = campaign.activeEffects
    .map((e) => ({ ...e, turnsRemaining: e.turnsRemaining - 1 }))
    .filter((e) => e.turnsRemaining > 0);

  activeEffects.push({ effect, turnsRemaining: duration });
  await patchCampaign(campaign.campaignId, "SET activeEffects = :fx", { ":fx": activeEffects });

  return { activeEffects };
}

export async function toolUseSpecialAbility(args: Record<string, unknown>, campaign: Campaign): Promise<SpecialAbilityResult> {
  const ability = String(args.abilityName ?? args.ability ?? "");

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
    await patchCampaign(campaign.campaignId, "SET specialAbilityState.vanishCooldownTurnsLeft = :cd", { ":cd": cooldownSet });
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

export async function toolUpdateQuestLog(args: Record<string, unknown>, campaign: Campaign): Promise<QuestLogResult> {
  const entry = String(args.entry ?? "");
  const timestamp = new Date().toISOString();
  const questLog = [...campaign.questLog, `[${timestamp}] ${entry}`];
  await patchCampaign(campaign.campaignId, "SET questLog = :ql", { ":ql": questLog });
  return { questLog };
}

export async function runTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  campaignId: string,
  turnId: string,
): Promise<ToolResult> {
  const idempotencyKey = makeIdempotencyKey(campaignId, turnId, toolName, String(toolArgs.purpose ?? toolArgs.item ?? toolName));

  const cached = await getCachedResult<ToolResult>(idempotencyKey);
  if (cached) {
    log({ toolName, campaignId, turnId, idempotencyHit: true, success: true });
    return cached;
  }

  const campaign = await getCampaign(campaignId);
  let result: ToolResult["result"];

  switch (toolName) {
    case "roll-dice":        result = await toolRollDice(toolArgs, campaign); break;
    case "apply-damage":     result = await toolApplyDamage(toolArgs, campaign); break;
    case "update-inventory": result = await toolUpdateInventory(toolArgs, campaign); break;
    case "award-xp":         result = await toolAwardXp(toolArgs, campaign); break;
    case "update-location":  result = await toolUpdateLocation(toolArgs, campaign); break;
    case "apply-effect":     result = await toolApplyEffect(toolArgs, campaign); break;
    case "use-special-ability": result = await toolUseSpecialAbility(toolArgs, campaign); break;
    case "update-quest-log": result = await toolUpdateQuestLog(toolArgs, campaign); break;
    default: throw new Error(`Unknown tool: ${toolName}`);
  }

  const toolResult: ToolResult = { toolName, result };
  await setCachedResult(idempotencyKey, toolResult);

  log({
    toolName,
    campaignId,
    turnId,
    idempotencyHit: false,
    success: true,
    ...(toolName === "roll-dice" ? { diceResult: (result as { total: number }).total } : {}),
    ...(toolName === "apply-damage" ? {
      newHp: (result as { newHp: number }).newHp,
      previousHp: (result as { previousHp: number }).previousHp,
    } : {}),
  });
  return toolResult;
}
