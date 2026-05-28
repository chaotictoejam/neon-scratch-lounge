import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { WorkflowInput, LoreChunk } from "../shared/types";
import { log } from "../shared/logger";

// Bundled lore — used when KNOWLEDGE_BASE_ID is not set (default, no AOSS cost)
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

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID ?? "";
const bedrockAgent = KNOWLEDGE_BASE_ID
  ? new BedrockAgentRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" })
  : null;

// ── Bedrock Knowledge Base path ──────────────────────────────────────────────

async function retrieveFromKnowledgeBase(query: string): Promise<LoreChunk[]> {
  const response = await bedrockAgent!.send(new RetrieveCommand({
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: { numberOfResults: 5 },
    },
  }));

  return (response.retrievalResults ?? []).map((r) => ({
    content: r.content?.text ?? "",
    score: r.score ?? 0,
  }));
}

// ── Bundled JSON path ─────────────────────────────────────────────────────────

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

function retrieveFromBundled(action: string, currentLocation: string, inventory: string[]): LoreChunk[] {
  const keywords = buildKeywords(action, currentLocation, inventory);

  const scored = ALL_LORE
    .map((entry) => ({ entry, score: scoreEntry(entry, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Always include the current location even if it scores 0
  const hasCurrentLocation = scored.some(({ entry }) => entry.id === currentLocation);
  if (!hasCurrentLocation) {
    const locationEntry = ALL_LORE.find((e) => e.id === currentLocation);
    if (locationEntry) scored.unshift({ entry: locationEntry, score: 1 });
  }

  return scored.map(({ entry, score }) => ({
    content: JSON.stringify(entry),
    score,
  }));
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (input: WorkflowInput): Promise<WorkflowInput & { loreChunks: LoreChunk[] }> => {
  const start = Date.now();
  const { action, campaign } = input;

  let loreChunks: LoreChunk[];

  if (KNOWLEDGE_BASE_ID) {
    const query = `${campaign.currentLocation} ${action}`;
    loreChunks = await retrieveFromKnowledgeBase(query);
  } else {
    loreChunks = retrieveFromBundled(action, campaign.currentLocation, campaign.inventory);
  }

  log({
    requestId: input.correlationId,
    campaignId: input.campaignId,
    retrieval: KNOWLEDGE_BASE_ID ? "bedrock-kb" : "bundled-json",
    chunksRetrieved: loreChunks.length,
    latencyMs: Date.now() - start,
  });

  return { ...input, loreChunks };
};
