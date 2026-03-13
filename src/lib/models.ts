import type { Model } from "@/types/database";

export interface ModelDef {
  id: string;
  model_id: string;
  label: string;
  provider_id: string;
  provider_name?: string;
  provider_type?: string;
}

export interface ModelWithProvider extends Model {
  provider_name: string;
  provider_type: string;
}

export function toModelDef(m: ModelWithProvider): ModelDef {
  return {
    id: m.id,
    model_id: m.model_id,
    label: m.label,
    provider_id: m.provider_id,
    provider_name: m.provider_name,
    provider_type: m.provider_type,
  };
}

export const BUILTIN_PROVIDER_IDS = {
  anthropic: "00000000-0000-0000-0000-000000000001",
  openai: "00000000-0000-0000-0000-000000000002",
  google: "00000000-0000-0000-0000-000000000003",
  deepseek: "00000000-0000-0000-0000-000000000004",
  groq: "00000000-0000-0000-0000-000000000005",
  openrouter: "00000000-0000-0000-0000-000000000006",
  zhipu: "00000000-0000-0000-0000-00000000000a",
  moonshot: "00000000-0000-0000-0000-00000000000b",
  minimax: "00000000-0000-0000-0000-00000000000c",
  dashscope: "00000000-0000-0000-0000-00000000000d",
  siliconflow: "00000000-0000-0000-0000-00000000000e",
  volcengine: "00000000-0000-0000-0000-00000000000f",
} as const;
