import { decrypt } from "@/lib/crypto/encrypt";
import { createStrictServiceClient } from "@/lib/supabase/server";
import type { SecretKeyName } from "@/types/database";

let _cache: Map<string, string> | null = null;

function getSupabaseForSecrets() {
  return createStrictServiceClient();
}

export async function getSecret(keyName: SecretKeyName): Promise<string | null> {
  if (_cache?.has(keyName)) {
    return _cache.get(keyName)!;
  }

  const supabase = getSupabaseForSecrets();

  const { data, error } = await supabase
    .from("secrets")
    .select("encrypted_value")
    .eq("key_name", keyName)
    .single();

  if (error || !data) return null;

  try {
    const value = decrypt(data.encrypted_value);
    if (!_cache) _cache = new Map();
    _cache.set(keyName, value);
    return value;
  } catch {
    return null;
  }
}

export function clearSecretsCache() {
  _cache = null;
}
