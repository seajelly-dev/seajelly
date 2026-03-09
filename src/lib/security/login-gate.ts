export const LOGIN_GATE_QUERY_PARAM = "k";
export const LOGIN_GATE_COOKIE = "oc_login_gate";
export const LOGIN_GATE_ENABLED_KEY = "login_gate_enabled";
export const LOGIN_GATE_HASH_KEY = "login_gate_key_hash";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

export function parseBooleanText(value: string | null | undefined): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}
