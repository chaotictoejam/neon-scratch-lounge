import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { WorkflowInput, LoreChunk } from "../shared/types";
import { log } from "../shared/logger";

const client = new BedrockAgentRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" });
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID!;

const LOCATION_NAMES = ["NeonScratchLounge", "ChromeAlley", "RoombaCoreTower", "NightMarket", "SewersOfForgetfulness"];
const ENEMY_NAMES = ["RoombaDrone", "LaserGangMember", "MutantRat", "EliteRoombaDrone", "VacuumDemon", "CEORoomba"];
const ITEM_NAMES = ["HackingClaws", "LaserPointerMk2", "AncientCatnip", "MysteryCanOfTuna", "NeonScratchCoat", "DroneCore", "MasterHackingKey"];

function buildQuery(action: string, currentLocation: string, campaign: WorkflowInput["campaign"]): string {
  const keywords: string[] = [currentLocation];

  for (const loc of LOCATION_NAMES) {
    if (action.toLowerCase().includes(loc.toLowerCase())) keywords.push(loc);
  }
  for (const enemy of ENEMY_NAMES) {
    if (action.toLowerCase().includes(enemy.toLowerCase())) keywords.push(enemy);
  }
  for (const item of ITEM_NAMES) {
    if (action.toLowerCase().includes(item.toLowerCase())) keywords.push(item);
  }
  // Also include inventory items for context
  for (const invItem of campaign.inventory.slice(0, 3)) {
    keywords.push(invItem);
  }

  const uniqueKeywords = [...new Set(keywords)];
  return `${action} ${uniqueKeywords.join(" ")}`.trim();
}

export const handler = async (input: WorkflowInput): Promise<WorkflowInput & { loreChunks: LoreChunk[] }> => {
  const start = Date.now();
  const query = buildQuery(input.action, input.campaign.currentLocation, input.campaign);

  const response = await client.send(new RetrieveCommand({
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: { numberOfResults: 5 },
    },
  }));

  const loreChunks: LoreChunk[] = (response.retrievalResults ?? []).map((r) => ({
    content: r.content?.text ?? "",
    score: r.score ?? 0,
    location: r.location?.s3Location?.uri,
  }));

  const latencyMs = Date.now() - start;
  log({
    requestId: input.correlationId,
    campaignId: input.campaignId,
    query,
    chunksRetrieved: loreChunks.length,
    latencyMs,
  });

  return { ...input, loreChunks };
};
