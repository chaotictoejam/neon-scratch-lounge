export function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...fields }));
}

export function logWarn(fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: "WARN", ...fields }));
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "ERROR", ...fields }));
}
