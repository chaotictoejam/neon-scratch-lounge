export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function latencyColor(ms: number): string {
  if (ms < 500) return "text-green-400";
  if (ms <= 2000) return "text-amber-400";
  return "text-red-400";
}

export function formatLocation(raw: string): string {
  return raw.replace(/([A-Z])/g, " $1").trim();
}

export function xpNeeded(level: number): number {
  return level * 100;
}
