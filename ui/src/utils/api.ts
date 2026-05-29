import { ApiTurnResponse, CharacterClass } from "../types";

const BASE_URL = (import.meta.env.VITE_API_GATEWAY_URL as string ?? "").replace(/\/$/, "");
const PLAYER_ID = (import.meta.env.VITE_PLAYER_ID as string) ?? "demo-player-aws-summit";

export async function sendAction(params: {
  campaignId: string | null;
  action: string;
  characterClass?: CharacterClass;
}): Promise<ApiTurnResponse> {
  const body: Record<string, unknown> = {
    playerId: PLAYER_ID,
    action: params.action,
  };
  if (params.campaignId) body.campaignId = params.campaignId;
  if (params.characterClass) body.characterClass = params.characterClass;

  const res = await fetch(`${BASE_URL}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Async flow: server returns { turnId } immediately, result arrives via polling
  if (data.turnId && !data.narrative) {
    return pollTurnResult(data.turnId);
  }

  return data as ApiTurnResponse;
}

async function pollTurnResult(turnId: string): Promise<ApiTurnResponse> {
  const MAX_ATTEMPTS = 45; // 90 seconds at 2s intervals
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${BASE_URL}/action/status?turnId=${encodeURIComponent(turnId)}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === "complete") return data.result as ApiTurnResponse;
      if (data.status === "error") throw new Error(data.message ?? "Turn failed");
      // status === "running" or "not_found" — keep polling
    } catch (err) {
      if (err instanceof Error && err.message !== "Turn failed" && !err.message.startsWith("Turn")) continue;
      throw err;
    }
  }
  throw new Error("Turn timed out — the DM is unreachable. Try again.");
}

export async function injectFailure(): Promise<void> {
  const res = await fetch(`${BASE_URL}/demo/inject-failure`, { method: "POST" });
  if (!res.ok) throw new Error(`inject-failure failed: ${res.status}`);
}

export async function clearFailure(): Promise<void> {
  const res = await fetch(`${BASE_URL}/demo/clear-failure`, { method: "POST" });
  if (!res.ok) throw new Error(`clear-failure failed: ${res.status}`);
}

export async function fetchCampaignLogs(campaignId: string): Promise<{ rows: Record<string, string>[] }> {
  const res = await fetch(`${BASE_URL}/demo/logs?campaignId=${encodeURIComponent(campaignId)}`);
  if (!res.ok) throw new Error(`fetch-logs failed: ${res.status}`);
  return res.json();
}
