export type ImageGenProvider = "google";

export interface ImageGenModel {
  id: string;
  name: string;
  description: string;
  provider: ImageGenProvider;
  inputTokenLimit: number;
  outputTokenLimit: number;
}

export const IMAGE_GEN_PROVIDERS: Record<ImageGenProvider, { name: string; description: string }> = {
  google: {
    name: "Google",
    description: "Google Gemini image generation models",
  },
};

export const IMAGE_GEN_MODELS: ImageGenModel[] = [
  {
    id: "gemini-3.1-flash-image-preview",
    name: "Gemini 3.1 Flash Image",
    description: "Fast, optimized for speed and throughput",
    provider: "google",
    inputTokenLimit: 131072,
    outputTokenLimit: 32768,
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "Gemini 3 Pro Image",
    description: "Professional-grade, high-fidelity generation",
    provider: "google",
    inputTokenLimit: 65536,
    outputTokenLimit: 32768,
  },
];

export function getModelsForProvider(provider: ImageGenProvider): ImageGenModel[] {
  return IMAGE_GEN_MODELS.filter((m) => m.provider === provider);
}

export function getProviderForModel(modelId: string): ImageGenProvider | null {
  const model = IMAGE_GEN_MODELS.find((m) => m.id === modelId);
  return model?.provider ?? null;
}
