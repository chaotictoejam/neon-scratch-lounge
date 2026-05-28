import { WorkflowInput, LoreChunk } from "../shared/types";
import { log } from "../shared/logger";

// Lore is bundled directly — 16KB total, no vector store needed.
import locations from "../../lore/locations.json";
import enemies from "../../lore/enemies.json";
import items from "../../lore/items.json";
import classes from "../../lore/classes.json";

type LoreEntry = { id: string; type?: string; [key: string]: unknown };

const ALL_LORE: LoreEntry[] = [
  ...(locations as LoreEntry[]),
  ...(enemies as LoreEntry[]),
  ...(items as LoreEntry[]),
  ...(classes as LoreEntry[]),
];

function scoreEntry(entry: LoreEntry, keywords: string[]): number {
  const text = JSON.stringify(entry).toLowerCase();
  return keywords.reduce((score, kw) => score + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
}

function buildKeywords(action: string, currentLocation: string, inventory: string[]): string[] {
  return [
    currentLocation,
    ...action.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    ...inventory.slice(0, 3),
  ].filter(Boolean);
}

export const handler = async (input: WorkflowInput): Promise<WorkflowInput & { loreChunks: LoreChunk[] }> => {
  const start = Date.now();
  const { action, campaign } = input;
  const keywords = buildKeywords(action, campaign.currentLocation, campaign.inventory);

  // Score and rank every lore entry, return the top 5 relevant ones
  const scored = ALL_LORE
    .map((entry) => ({ entry, score: scoreEntry(entry, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Always include the current location even if it scores 0
  const hasCurrentLocation = scored.some(({ entry }) => entry.id === campaign.currentLocation);
  if (!hasCurrentLocation) {
    const locationEntry = ALL_LORE.find((e) => e.id === campaign.currentLocation);
    if (locationEntry) scored.unshift({ entry: locationEntry, score: 1 });
  }

  const loreChunks: LoreChunk[] = scored.map(({ entry, score }) => ({
    content: JSON.stringify(entry),
    score,
  }));

  log({
    requestId: input.correlationId,
    campaignId: input.campaignId,
    keywords,
    chunksRetrieved: loreChunks.length,
    latencyMs: Date.now() - start,
  });

  return { ...input, loreChunks };
};
