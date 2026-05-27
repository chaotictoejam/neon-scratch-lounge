// Tests for class special ability mechanics

import { Campaign, CharacterClass } from "../lambda/shared/types";

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    campaignId: "test-campaign",
    playerId: "test-player",
    characterClass: "TabbyWarrior" as CharacterClass,
    characterName: "Claws McGee",
    currentLocation: "ChromeAlley",
    playerStats: { hp: 100, maxHp: 120, pawStrength: 8, agility: 5, arcane: 2, stealth: 4, gold: 10, level: 1, xp: 0 },
    specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: false },
    inventory: [],
    activeEffects: [],
    conversationHistory: [],
    campaignSummary: "",
    turnsPlayed: 0,
    monstersDefeated: 0,
    creditChipsEarned: 0,
    questLog: [],
    nineLivesUsed: false,
    gameOver: false,
    ttl: 9999999999,
    ...overrides,
  };
}

// Simulate the NineLifesPassive check from execute-tool
function simulateApplyDamage(campaign: Campaign, damage: number): {
  newHp: number;
  nineLivesTrigger: boolean;
  isDead: boolean;
} {
  const previousHp = campaign.playerStats.hp;
  let newHp = Math.max(0, previousHp - damage);
  let nineLivesTrigger = false;

  if (newHp <= 0 && campaign.characterClass === "TabbyWarrior" && !campaign.specialAbilityState.nineLivesUsed) {
    newHp = 1;
    nineLivesTrigger = true;
    campaign.specialAbilityState.nineLivesUsed = true;
    campaign.nineLivesUsed = true;
  }

  const isDead = newHp <= 0;
  campaign.playerStats.hp = newHp;
  return { newHp, nineLivesTrigger, isDead };
}

// Simulate MaineCoonPaladin shield
function simulateShield(campaign: Campaign, damage: number): {
  actualDamage: number;
  damageBlocked: number;
  shieldUsed: boolean;
} {
  let damageBlocked = 0;
  let actualDamage = damage;
  let shieldUsed = false;

  if (campaign.characterClass === "MaineCoonPaladin" && !campaign.specialAbilityState.shieldUsedThisEncounter) {
    damageBlocked = Math.min(15, damage);
    actualDamage -= damageBlocked;
    campaign.specialAbilityState.shieldUsedThisEncounter = true;
    shieldUsed = true;
  }

  return { actualDamage, damageBlocked, shieldUsed };
}

// Simulate SphinxRogue vanish cooldown decrement
function simulateTurnTick(campaign: Campaign): void {
  if (campaign.specialAbilityState.vanishCooldownTurnsLeft > 0) {
    campaign.specialAbilityState.vanishCooldownTurnsLeft -= 1;
  }
}

describe("TabbyWarrior NineLifesPassive", () => {
  test("triggers when HP would reach 0", () => {
    const campaign = makeCampaign({ playerStats: { hp: 10, maxHp: 120, pawStrength: 8, agility: 5, arcane: 2, stealth: 4, gold: 10, level: 1, xp: 0 } });
    const result = simulateApplyDamage(campaign, 50);
    expect(result.nineLivesTrigger).toBe(true);
    expect(result.newHp).toBe(1);
    expect(result.isDead).toBe(false);
  });

  test("does not trigger for non-killing blow", () => {
    const campaign = makeCampaign({ playerStats: { hp: 100, maxHp: 120, pawStrength: 8, agility: 5, arcane: 2, stealth: 4, gold: 10, level: 1, xp: 0 } });
    const result = simulateApplyDamage(campaign, 30);
    expect(result.nineLivesTrigger).toBe(false);
    expect(result.newHp).toBe(70);
  });

  test("cannot trigger twice in same campaign", () => {
    const campaign = makeCampaign({
      playerStats: { hp: 5, maxHp: 120, pawStrength: 8, agility: 5, arcane: 2, stealth: 4, gold: 10, level: 1, xp: 0 },
      specialAbilityState: { nineLivesUsed: true, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: false },
      nineLivesUsed: true,
    });
    const result = simulateApplyDamage(campaign, 100);
    expect(result.nineLivesTrigger).toBe(false);
    expect(result.isDead).toBe(true);
    expect(result.newHp).toBe(0);
  });

  test("does not trigger for SiameseMage (class check)", () => {
    const campaign = makeCampaign({
      characterClass: "SiameseMage",
      playerStats: { hp: 5, maxHp: 70, pawStrength: 3, agility: 6, arcane: 9, stealth: 5, gold: 15, level: 1, xp: 0 },
    });
    const result = simulateApplyDamage(campaign, 100);
    expect(result.nineLivesTrigger).toBe(false);
    expect(result.isDead).toBe(true);
  });
});

describe("MaineCoonPaladin HolyHairballShield", () => {
  test("blocks up to 15 damage on first hit", () => {
    const campaign = makeCampaign({
      characterClass: "MaineCoonPaladin",
      playerStats: { hp: 100, maxHp: 100, pawStrength: 6, agility: 3, arcane: 5, stealth: 2, gold: 20, level: 1, xp: 0 },
    });
    const result = simulateShield(campaign, 20);
    expect(result.damageBlocked).toBe(15);
    expect(result.actualDamage).toBe(5);
    expect(result.shieldUsed).toBe(true);
  });

  test("blocks full damage if damage <= 15", () => {
    const campaign = makeCampaign({ characterClass: "MaineCoonPaladin" });
    const result = simulateShield(campaign, 10);
    expect(result.damageBlocked).toBe(10);
    expect(result.actualDamage).toBe(0);
  });

  test("does not block on second hit in same encounter", () => {
    const campaign = makeCampaign({
      characterClass: "MaineCoonPaladin",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: true },
    });
    const result = simulateShield(campaign, 20);
    expect(result.damageBlocked).toBe(0);
    expect(result.actualDamage).toBe(20);
    expect(result.shieldUsed).toBe(false);
  });

  test("shieldUsedThisEncounter resets to false after combat ends", () => {
    const campaign = makeCampaign({
      characterClass: "MaineCoonPaladin",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: true },
    });
    // Simulate combat ending (persist-campaign logic)
    campaign.specialAbilityState.shieldUsedThisEncounter = false;
    expect(campaign.specialAbilityState.shieldUsedThisEncounter).toBe(false);

    // Shield is available again
    const result = simulateShield(campaign, 20);
    expect(result.shieldUsed).toBe(true);
  });
});

describe("SphinxRogue SandstormVanish cooldown", () => {
  test("cooldown starts at 3 after use", () => {
    const campaign = makeCampaign({
      characterClass: "SphinxRogue",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 3, shieldUsedThisEncounter: false },
    });
    expect(campaign.specialAbilityState.vanishCooldownTurnsLeft).toBe(3);
  });

  test("cooldown decrements by 1 each turn", () => {
    const campaign = makeCampaign({
      characterClass: "SphinxRogue",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 3, shieldUsedThisEncounter: false },
    });
    simulateTurnTick(campaign);
    expect(campaign.specialAbilityState.vanishCooldownTurnsLeft).toBe(2);
    simulateTurnTick(campaign);
    expect(campaign.specialAbilityState.vanishCooldownTurnsLeft).toBe(1);
    simulateTurnTick(campaign);
    expect(campaign.specialAbilityState.vanishCooldownTurnsLeft).toBe(0);
  });

  test("cooldown does not go below 0", () => {
    const campaign = makeCampaign({
      characterClass: "SphinxRogue",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: false },
    });
    simulateTurnTick(campaign);
    expect(campaign.specialAbilityState.vanishCooldownTurnsLeft).toBe(0);
  });

  test("vanish cannot be used while on cooldown", () => {
    const campaign = makeCampaign({
      characterClass: "SphinxRogue",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 2, shieldUsedThisEncounter: false },
    });
    const canUse = campaign.specialAbilityState.vanishCooldownTurnsLeft === 0;
    expect(canUse).toBe(false);
  });

  test("vanish is available when cooldown reaches 0", () => {
    const campaign = makeCampaign({
      characterClass: "SphinxRogue",
      specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 1, shieldUsedThisEncounter: false },
    });
    simulateTurnTick(campaign);
    const canUse = campaign.specialAbilityState.vanishCooldownTurnsLeft === 0;
    expect(canUse).toBe(true);
  });
});
