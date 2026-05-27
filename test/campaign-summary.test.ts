// Tests for campaign summarization logic

import { Campaign, CharacterClass } from "../lambda/shared/types";

const MAX_CONVERSATION_HISTORY = 20;
const HISTORY_TRIM_COUNT = 5;

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    campaignId: "test-campaign",
    playerId: "test-player",
    characterClass: "TabbyWarrior" as CharacterClass,
    characterName: "Claws McGee",
    currentLocation: "ChromeAlley",
    playerStats: { hp: 87, maxHp: 120, pawStrength: 8, agility: 5, arcane: 2, stealth: 4, gold: 35, level: 2, xp: 100 },
    specialAbilityState: { nineLivesUsed: false, vanishCooldownTurnsLeft: 0, shieldUsedThisEncounter: false },
    inventory: ["HackingClaws", "DroneCore", "MysteryCanOfTuna"],
    activeEffects: [],
    conversationHistory: [],
    campaignSummary: "",
    turnsPlayed: 5,
    monstersDefeated: 2,
    creditChipsEarned: 30,
    questLog: ["Locate the data broker in the NightMarket"],
    nineLivesUsed: false,
    gameOver: false,
    ttl: 9999999999,
    ...overrides,
  };
}

function makeTurnHistory(turns: number): { role: string; content: string }[] {
  const history = [];
  for (let i = 0; i < turns; i++) {
    history.push({ role: "user", content: `Turn ${i + 1} action` });
    history.push({ role: "assistant", content: `Turn ${i + 1} narrative` });
  }
  return history;
}

function generateSummary(campaign: Campaign): string {
  const recentItems = campaign.inventory.slice(-3).join(", ") || "nothing of note";
  const lastQuest = campaign.questLog[campaign.questLog.length - 1] ?? "No active quests";
  return `Operative ${campaign.characterName}, a ${campaign.characterClass}, has survived ${campaign.turnsPlayed} turns in Neo-Pawsburg. They have neutralised ${campaign.monstersDefeated} threats, accumulated ${campaign.playerStats.gold} CreditChips, and currently operate from ${campaign.currentLocation} at ${campaign.playerStats.hp}/${campaign.playerStats.maxHp} HP. Recent acquisitions: ${recentItems}. Active quests: ${lastQuest}`;
}

function processHistory(
  campaign: Campaign,
  newAction: string,
  newNarrative: string
): { conversationHistory: { role: string; content: string }[]; campaignSummary: string } {
  const newHistory = [
    ...campaign.conversationHistory,
    { role: "user", content: newAction },
    { role: "assistant", content: newNarrative },
  ];

  let campaignSummary = campaign.campaignSummary;
  let trimmedHistory = newHistory;

  if (newHistory.length > MAX_CONVERSATION_HISTORY * 2) {
    campaignSummary = generateSummary(campaign);
    trimmedHistory = newHistory.slice(-HISTORY_TRIM_COUNT * 2);
  }

  return { conversationHistory: trimmedHistory, campaignSummary };
}

describe("Campaign summary and history management", () => {
  test("summary does NOT trigger below 20 turns", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(18) });
    const result = processHistory(campaign, "action 19", "narrative 19");
    // 19 turns + 1 new = 20 total = 40 history entries — at threshold, not over
    expect(result.campaignSummary).toBe("");
    expect(result.conversationHistory.length).toBeGreaterThan(0);
  });

  test("summary triggers at exactly 20 turns", () => {
    // 20 turns × 2 messages = 40 history entries already, adding 1 more = 42 > 40
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(20) });
    const result = processHistory(campaign, "action 21", "narrative 21");
    expect(result.campaignSummary).not.toBe("");
  });

  test("history is trimmed to HISTORY_TRIM_COUNT * 2 entries after summarization", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.conversationHistory).toHaveLength(HISTORY_TRIM_COUNT * 2);
  });

  test("summary includes characterName", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.campaignSummary).toContain("Claws McGee");
  });

  test("summary includes characterClass", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.campaignSummary).toContain("TabbyWarrior");
  });

  test("summary includes currentLocation", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.campaignSummary).toContain("ChromeAlley");
  });

  test("summary includes hp/maxHp", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.campaignSummary).toContain("87/120");
  });

  test("summary includes last inventory items (up to 3)", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.campaignSummary).toContain("HackingClaws");
    expect(result.campaignSummary).toContain("MysteryCanOfTuna");
  });

  test("summary includes last quest log entry", () => {
    const campaign = makeCampaign({ conversationHistory: makeTurnHistory(22) });
    const result = processHistory(campaign, "action 23", "narrative 23");
    expect(result.campaignSummary).toContain("NightMarket");
  });
});
