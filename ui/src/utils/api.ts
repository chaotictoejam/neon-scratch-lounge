import { ApiTurnResponse, CharacterClass } from "../types";

const BASE_URL = import.meta.env.VITE_API_GATEWAY_URL as string;
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

  return res.json() as Promise<ApiTurnResponse>;
}

export async function injectFailure(): Promise<void> {
  await fetch(`${BASE_URL}/demo/inject-failure`, { method: "POST" });
}

export async function clearFailure(): Promise<void> {
  await fetch(`${BASE_URL}/demo/clear-failure`, { method: "POST" });
}
